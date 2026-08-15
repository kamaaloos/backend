import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderMode,
  OrderStatus,
  Payment,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  TableStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreatePaymentDto, CreatePendingCashDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentProviderService } from './payment-provider';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import type { Span } from '@opentelemetry/api';
import { withSpan } from '../telemetry/tracing';
import { recordPaymentSettleDurationMs } from '../telemetry/metrics';
import {
  balanceDue,
  isOrderFullyPaid,
  lineTotal,
} from './payment-balance';
import { resolvePaymentChannel } from './payment-channel';

function observePaymentSettle(
  createdAt: Date | string | null | undefined,
  paidAt: Date | string | null | undefined,
  span?: Span,
) {
  if (!paidAt || !createdAt) return;
  const createdMs = new Date(createdAt).getTime();
  const paidMs = new Date(paidAt).getTime();
  if (!Number.isFinite(createdMs) || !Number.isFinite(paidMs)) return;
  const ms = paidMs - createdMs;
  span?.setAttribute('payment.settle_duration_ms', ms);
  recordPaymentSettleDurationMs(ms);
}
type PaymentReceivedBy = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
};

type PaymentResponse = Payment & {
  currency: string;
  checkoutUrl?: string;
  clientSecret?: string;
  receivedBy?: PaymentReceivedBy | null;
};

const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.NEW,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.SERVED,
];

/** Owns PaymentLines for split-by-item. FAILED/VOIDED free lines; REFUNDED does not. */
const ALLOCATING_STATUSES: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];

const orderEventInclude = {
  table: true,
  items: { include: { menuItem: true } },
  restaurant: { select: { currency: true } },
  payments: true,
} satisfies Prisma.OrderInclude;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly realtime: RealtimePublisher,
    private readonly paymentProvider: PaymentProviderService,
  ) { }

  getProviderConfig() {
    return this.paymentProvider.getPublicConfig();
  }

  /**
   * Record Stripe evt_ id before processing. Returns false if already seen.
   */
  async claimStripeWebhookEvent(eventId: string, type: string): Promise<boolean> {
    try {
      await this.prisma.stripeWebhookEvent.create({
        data: { id: eventId, type },
      });
      return true;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return false;
      }
      throw err;
    }
  }

  async create(user: JwtPayload, dto: CreatePaymentDto): Promise<PaymentResponse> {
    return withSpan(
      'payment.create',
      {
        'order.id': dto.orderId,
        'payment.method': dto.method,
      },
      async (span) => this.createInner(user, dto, span),
    );
  }

  /**
   * Explicit till operation: record unpaid CASH to settle later via markPaid.
   * Clients cannot choose PENDING on POST /payments — only this endpoint.
   */
  async createPendingCash(
    user: JwtPayload,
    dto: CreatePendingCashDto,
  ): Promise<PaymentResponse> {
    return withSpan(
      'payment.create_pending_cash',
      {
        'order.id': dto.orderId,
        'payment.method': PaymentMethod.CASH,
      },
      async (span) =>
        this.createInner(
          user,
          { ...dto, method: PaymentMethod.CASH },
          span,
          { forcePendingCash: true },
        ),
    );
  }

  private async createInner(
    user: JwtPayload,
    dto: CreatePaymentDto,
    span: Span,
    opts?: { forcePendingCash?: boolean },
  ): Promise<PaymentResponse> {
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      include: {
        payments: { include: { lines: true } },
        items: true,
        restaurant: { select: { currency: true } },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    await this.authorization.canAccessBranch(user, order.branchId);

    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot pay for a cancelled order');
    }

    this.assertMethodAllowed(dto.method);
    span.setAttribute('order.branch_id', order.branchId);
    span.setAttribute('order.mode', order.mode);

    const tipAmount = Number(dto.tipAmount ?? 0);
    if (tipAmount < 0) {
      throw new BadRequestException('Tip cannot be negative');
    }

    const remaining = balanceDue(Number(order.total), order.payments);
    if (remaining <= 0.001) {
      throw new ConflictException('Order balance is already covered');
    }

    const { cover, lines } = this.resolveSplitCover(order, dto, remaining);
    const amount = Number((cover + tipAmount).toFixed(2));
    if (dto.amount != null && Math.abs(Number(dto.amount) - amount) > 0.001) {
      throw new BadRequestException(
        `Payment amount must equal cover + tip (${amount})`,
      );
    }

    let status: PaymentStatus;
    if (opts?.forcePendingCash) {
      if (dto.method !== PaymentMethod.CASH) {
        throw new BadRequestException(
          'Pending cash recording is only allowed for CASH',
        );
      }
      status = PaymentStatus.PENDING;
    } else {
      try {
        status = this.paymentProvider.initialStatusFor(dto.method);
      } catch (err) {
        const code = err instanceof Error ? err.message : '';
        if (code === 'TERMINAL_REQUIRED') {
          throw new BadRequestException(
            'CARD requires Stripe Terminal. Use CARD_MANUAL for honor-system card, or enable Terminal.',
          );
        }
        throw new BadRequestException(
          'ONLINE payments require PAYMENT_PROVIDER=mock|stripe. Use CASH, CARD (Terminal), or CARD_MANUAL.',
        );
      }
    }
    const paidAt = status === PaymentStatus.PAID ? new Date() : null;
    const isOnline = dto.method === PaymentMethod.ONLINE;
    const isTerminalCard = dto.method === PaymentMethod.CARD;
    const channel = resolvePaymentChannel(dto.method);

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          amount,
          tipAmount,
          method: dto.method,
          channel,
          status,
          paidAt,
          receivedByUserId: user.sub ?? user.id,
          provider:
            isOnline || isTerminalCard
              ? this.paymentProvider.getProviderId()
              : null,
          lines: lines.length
            ? {
              create: lines.map((line) => ({
                orderItemId: line.orderItemId,
                amount: line.amount,
              })),
            }
            : undefined,
        },
        include: {
          receivedBy: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      let completed = false;
      let releasedToKitchen = false;
      let workingStatus = order.status;

      if (status === PaymentStatus.PAID) {
        const payments = [...order.payments, payment];
        releasedToKitchen = await this.releaseWalkInToKitchen(
          tx,
          order.id,
          order.mode,
          workingStatus,
          payments,
          Number(order.total),
        );
        if (releasedToKitchen) {
          workingStatus = OrderStatus.NEW;
        }

        completed = await this.completeOrderIfServed(
          tx,
          order.id,
          order.tableId,
          workingStatus,
          payments,
          Number(order.total),
        );
      }

      return { payment, completed, releasedToKitchen };
    });

    let payment = result.payment;
    let checkoutUrl: string | undefined;
    let clientSecret: string | undefined;
    if (isOnline) {
      const cashier = this.paymentProvider.cashierAppUrl();
      const checkout = await this.paymentProvider.createOnlineCheckout({
        paymentId: payment.id,
        orderId: order.id,
        amount: payment.amount,
        currency: order.restaurant.currency,
        tipAmount: payment.tipAmount,
        successUrl: `${cashier}?paid=1&orderId=${order.id}`,
        cancelUrl: `${cashier}?paid=0&orderId=${order.id}`,
      });
      payment = await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          provider: checkout.provider,
          providerRef: checkout.providerRef,
        },
      });
      checkoutUrl = checkout.checkoutUrl;
      span.setAttribute('payment.provider', checkout.provider);
    } else if (isTerminalCard) {
      const intent = await this.paymentProvider.createCardPresentIntent({
        paymentId: payment.id,
        orderId: order.id,
        amount: payment.amount,
        currency: order.restaurant.currency,
        tipAmount: payment.tipAmount,
      });
      payment = await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          provider: intent.provider,
          providerRef: intent.providerRef,
        },
      });
      clientSecret = intent.clientSecret;
      span.setAttribute('payment.provider', intent.provider);
      span.setAttribute('payment.terminal', true);
    }

    span.setAttribute('payment.status', status);
    span.setAttribute('payment.amount', amount);
    span.setAttribute('payment.tip_amount', tipAmount);
    span.setAttribute('payment.cover', cover);
    span.setAttribute('payment.channel', channel);
    if (status === PaymentStatus.PAID) {
      observePaymentSettle(payment.createdAt, payment.paidAt, span);
    }

    const response: PaymentResponse = {
      ...payment,
      currency: order.restaurant.currency,
      checkoutUrl,
      clientSecret,
    };

    this.realtime.publishPaymentUpdated({
      ...response,
      restaurantId: order.restaurantId,
      branchId: order.branchId,
    });

    if (result.releasedToKitchen) {
      await this.emitWalkInReleasedToKitchen(order.id);
    }

    if (result.completed) {
      await this.emitOrderCompleted(order.id, order.status);
    }

    return response;
  }

  /**
   * Public walk-in prepay — full balance only; marks PAID and releases to kitchen.
   */
  async payWalkInOrder(
    branchId: string,
    orderId: string,
    method: PaymentMethod,
    walkInToken?: string,
  ): Promise<{
    payment: PaymentResponse;
    order: { id: string; status: OrderStatus; queueNumber: number | null };
  }> {
    return withSpan(
      'payment.walk_in_pay',
      {
        'order.id': orderId,
        'order.branch_id': branchId,
        'payment.method': method,
      },
      async () =>
        this.payWalkInOrderInner(branchId, orderId, method, walkInToken),
    );
  }

  private async payWalkInOrderInner(
    branchId: string,
    orderId: string,
    method: PaymentMethod,
    walkInToken?: string,
  ): Promise<{
    payment: PaymentResponse;
    order: { id: string; status: OrderStatus; queueNumber: number | null };
  }> {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        branchId,
        mode: OrderMode.WALK_IN,
      },
      include: {
        payments: true,
        items: true,
        restaurant: { select: { currency: true } },
      },
    });

    if (!order) {
      throw new NotFoundException('Walk-in order not found');
    }

    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot pay for a cancelled order');
    }

    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException(
        'Only unpaid walk-in orders can be prepaid here',
      );
    }

    const remaining = balanceDue(Number(order.total), order.payments);
    if (remaining <= 0.001) {
      throw new ConflictException('Order is already paid');
    }
    if (Math.abs(remaining - Number(order.total)) > 0.001) {
      throw new ConflictException(
        'Walk-in prepay requires a single full payment',
      );
    }

    this.assertMethodAllowed(method);

    const amount = remaining;
    if (amount <= 0) {
      throw new BadRequestException('Payment amount must be positive');
    }

    const isOnline = method === PaymentMethod.ONLINE;
    const lines = order.items.map((item) => ({
      orderItemId: item.id,
      amount: lineTotal(item),
    }));

    if (isOnline) {
      const payment = await this.prisma.payment.create({
        data: {
          orderId: order.id,
          amount,
          tipAmount: 0,
          method,
          channel: resolvePaymentChannel(method),
          status: PaymentStatus.PENDING,
          provider: this.paymentProvider.getProviderId(),
          lines: { create: lines },
        },
      });

      const customer = this.paymentProvider.customerAppUrl();
      const publicKey = walkInToken || branchId;
      const checkout = await this.paymentProvider.createOnlineCheckout({
        paymentId: payment.id,
        orderId: order.id,
        amount: payment.amount,
        currency: order.restaurant.currency,
        tipAmount: payment.tipAmount,
        successUrl: `${customer}/w/${publicKey}/orders/${order.id}?paid=1`,
        cancelUrl: `${customer}/w/${publicKey}/orders/${order.id}?paid=0`,
      });

      const updated = await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          provider: checkout.provider,
          providerRef: checkout.providerRef,
        },
      });

      const response: PaymentResponse = {
        ...updated,
        currency: order.restaurant.currency,
        checkoutUrl: checkout.checkoutUrl,
      };

      this.realtime.publishPaymentUpdated({
        ...response,
        restaurantId: order.restaurantId,
        branchId: order.branchId,
      });

      return {
        payment: response,
        order: {
          id: order.id,
          status: order.status,
          queueNumber: order.queueNumber,
        },
      };
    }

    // Terminal CARD and Stripe honor-system must not settle from the phone.
    // Use ONLINE Checkout, or CARD/CARD_MANUAL at the cashier.
    if (
      (method === PaymentMethod.CARD || method === PaymentMethod.CARD_MANUAL) &&
      this.paymentProvider.getProviderId() === 'stripe'
    ) {
      throw new BadRequestException(
        'Card capture requires Stripe Checkout (ONLINE) or Terminal/manual card at the cashier. Cannot settle card from the customer app.',
      );
    }

    if (method === PaymentMethod.CARD) {
      throw new BadRequestException(
        'CARD is Terminal-only. Pay at the cashier reader, or use ONLINE Checkout.',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          amount,
          tipAmount: 0,
          method,
          channel: resolvePaymentChannel(method),
          status: PaymentStatus.PAID,
          paidAt: new Date(),
          lines: { create: lines },
        },
      });

      await this.releaseWalkInToKitchen(
        tx,
        order.id,
        order.mode,
        order.status,
        [...order.payments, payment],
        Number(order.total),
      );

      return payment;
    });

    const response = {
      ...result,
      currency: order.restaurant.currency,
    };

    observePaymentSettle(result.createdAt, result.paidAt);

    this.realtime.publishPaymentUpdated({
      ...response,
      restaurantId: order.restaurantId,
      branchId: order.branchId,
    });

    await this.emitWalkInReleasedToKitchen(order.id);

    return {
      payment: response,
      order: {
        id: order.id,
        status: OrderStatus.NEW,
        queueNumber: order.queueNumber,
      },
    };
  }

  async findByOrder(
    orderId: string,
    user: JwtPayload,
  ): Promise<{
    currency: string;
    balanceDue: number;
    payments: PaymentResponse[];
    payment: PaymentResponse | null;
  }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        payments: {
          orderBy: { createdAt: 'asc' },
          include: {
            receivedBy: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        restaurant: { select: { currency: true } },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    await this.authorization.canAccessBranch(user, order.branchId);

    const currency = order.restaurant.currency;
    const payments = order.payments.map((p) => ({ ...p, currency }));
    return {
      currency,
      balanceDue: balanceDue(Number(order.total), order.payments),
      payments,
      payment: payments[payments.length - 1] ?? null,
    };
  }

  async markPaid(id: string, user: JwtPayload): Promise<PaymentResponse> {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        order: {
          include: {
            payments: true,
            restaurant: { select: { currency: true } },
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    await this.authorization.canAccessBranch(user, payment.order.branchId);

    // Manual settle: CASH / CARD_MANUAL / mock ONLINE only.
    // Never trust the UI to mark Stripe Terminal CARD as paid.
    if (payment.method === PaymentMethod.CARD) {
      throw new BadRequestException(
        'CARD (Terminal) cannot be marked paid manually. Settle via Stripe webhook (payment_intent.succeeded).',
      );
    }

    if (payment.method === PaymentMethod.ONLINE) {
      if (payment.provider === 'stripe') {
        throw new BadRequestException(
          'Stripe Checkout settles via webhook (checkout.session.completed). Use mock provider for manual markPaid.',
        );
      }
      // mock ONLINE: staff can complete after simulated checkout
    } else if (
      payment.method !== PaymentMethod.CASH &&
      payment.method !== PaymentMethod.CARD_MANUAL
    ) {
      throw new BadRequestException(
        'Only CASH, CARD_MANUAL, or mock ONLINE payments can be marked paid manually',
      );
    }

    return this.settlePendingPayment(payment, {
      receivedByUserId: user.sub ?? user.id,
    });
  }

  /**
   * Stripe-verified reconcile for Terminal intents (local/dev without webhooks).
   * Primary authority remains payment_intent.succeeded → settleOnlineBy*.
   * Callers must not treat the client processPayment result as paid by itself.
   */
  async confirmTerminalPayment(
    id: string,
    user: JwtPayload,
  ): Promise<PaymentResponse> {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        order: {
          include: {
            payments: true,
            restaurant: { select: { currency: true } },
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    await this.authorization.canAccessBranch(user, payment.order.branchId);

    if (payment.status === PaymentStatus.PAID) {
      const { order: _order, ...rest } = payment;
      return { ...rest, currency: payment.order.restaurant.currency };
    }

    if (
      payment.method !== PaymentMethod.CARD ||
      payment.provider !== 'stripe' ||
      !payment.providerRef
    ) {
      throw new BadRequestException(
        'Only Stripe Terminal card payments can be reconciled this way',
      );
    }

    const intent = await this.paymentProvider.retrievePaymentIntentStatus(
      payment.providerRef,
    );
    if (intent.status !== 'succeeded') {
      throw new BadRequestException(
        `PaymentIntent is ${intent.status}, not succeeded yet`,
      );
    }

    return this.settlePendingPayment(payment, {
      receivedByUserId: user.sub ?? user.id,
    });
  }

  createTerminalConnectionToken() {
    return this.paymentProvider.createTerminalConnectionToken();
  }

  listTerminalReaders() {
    return this.paymentProvider.listTerminalReaders();
  }

  registerTerminalReader(dto: { registrationCode: string; label: string }) {
    return this.paymentProvider.registerTerminalReader(dto);
  }

  async failPendingByProviderRef(providerRef: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { providerRef },
      include: {
        order: {
          include: {
            restaurant: { select: { currency: true } },
          },
        },
      },
    });
    if (!payment || payment.status !== PaymentStatus.PENDING) {
      return null;
    }

    const failed = await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.FAILED },
    });

    const response = {
      ...failed,
      currency: payment.order.restaurant.currency,
    };
    this.realtime.publishPaymentUpdated({
      ...response,
      restaurantId: payment.order.restaurantId,
      branchId: payment.order.branchId,
    });
    return response;
  }

  async settleOnlineById(paymentId: string, providerRef?: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        order: {
          include: {
            payments: true,
            restaurant: { select: { currency: true } },
          },
        },
      },
    });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    if (
      providerRef &&
      payment.providerRef &&
      payment.providerRef !== providerRef
    ) {
      throw new BadRequestException('Stripe session does not match payment');
    }
    return this.settlePendingPayment(payment);
  }

  async settleOnlineByProviderRef(providerRef: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { providerRef },
      include: {
        order: {
          include: {
            payments: true,
            restaurant: { select: { currency: true } },
          },
        },
      },
    });
    if (!payment) {
      throw new NotFoundException('Payment not found for Stripe session');
    }
    return this.settlePendingPayment(payment);
  }

  private async settlePendingPayment(
    payment: Payment & {
      order: {
        id: string;
        status: OrderStatus;
        mode: OrderMode;
        tableId: string | null;
        restaurantId: string;
        branchId: string;
        total: Prisma.Decimal | number;
        payments: Payment[];
        restaurant: { currency: string };
      };
    },
    opts?: { receivedByUserId?: string },
  ): Promise<PaymentResponse> {
    const currency = payment.order.restaurant.currency;

    if (payment.status === PaymentStatus.PAID) {
      const { order: _order, ...rest } = payment;
      return { ...rest, currency };
    }

    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException(
        `Cannot mark ${payment.status} payment as paid`,
      );
    }

    if (payment.order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot pay for a cancelled order');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const paid = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.PAID,
          paidAt: new Date(),
          ...(opts?.receivedByUserId
            ? { receivedByUserId: opts.receivedByUserId }
            : {}),
        },
        include: {
          receivedBy: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      let workingStatus = payment.order.status;
      const payments = payment.order.payments.map((p) =>
        p.id === paid.id ? paid : p,
      );
      const releasedToKitchen = await this.releaseWalkInToKitchen(
        tx,
        payment.orderId,
        payment.order.mode,
        workingStatus,
        payments,
        Number(payment.order.total),
      );
      if (releasedToKitchen) {
        workingStatus = OrderStatus.NEW;
      }

      const completed = await this.completeOrderIfServed(
        tx,
        payment.orderId,
        payment.order.tableId,
        workingStatus,
        payments,
        Number(payment.order.total),
      );

      return { payment: paid, completed, releasedToKitchen };
    });

    const response = {
      ...result.payment,
      currency,
    };

    observePaymentSettle(
      payment.createdAt,
      result.payment.paidAt,
    );

    this.realtime.publishPaymentUpdated({
      ...response,
      restaurantId: payment.order.restaurantId,
      branchId: payment.order.branchId,
    });

    if (result.releasedToKitchen) {
      await this.emitWalkInReleasedToKitchen(payment.orderId);
    }

    if (result.completed) {
      await this.emitOrderCompleted(payment.orderId, payment.order.status);
    }

    return response;
  }

  async refund(
    id: string,
    user: JwtPayload,
    dto: RefundPaymentDto,
  ): Promise<PaymentResponse> {
    return withSpan(
      'payment.refund',
      { 'payment.id': id },
      async (span) => this.refundInner(id, user, dto, span),
    );
  }

  private async refundInner(
    id: string,
    user: JwtPayload,
    dto: RefundPaymentDto,
    span: Span,
  ): Promise<PaymentResponse> {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        order: {
          include: {
            restaurant: { select: { currency: true } },
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    await this.authorization.canAccessBranch(user, payment.order.branchId);
    span.setAttribute('order.id', payment.orderId);
    span.setAttribute('order.branch_id', payment.order.branchId);

    if (
      payment.status !== PaymentStatus.PAID &&
      payment.status !== PaymentStatus.PARTIALLY_REFUNDED
    ) {
      throw new BadRequestException(
        `Cannot refund a ${payment.status} payment`,
      );
    }

    const charged = Number(payment.amount);
    const alreadyRefunded = Number(payment.refundedAmount);
    const remaining = Number((charged - alreadyRefunded).toFixed(2));
    if (remaining <= 0) {
      throw new BadRequestException('Payment is already fully refunded');
    }

    const refundAmount =
      dto.amount != null ? Number(dto.amount) : remaining;
    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
      throw new BadRequestException('Refund amount must be positive');
    }
    if (refundAmount > remaining + 0.001) {
      throw new BadRequestException(
        `Refund exceeds remaining balance (${remaining})`,
      );
    }

    const newRefunded = Number((alreadyRefunded + refundAmount).toFixed(2));
    const fullyRefunded = newRefunded >= charged - 0.001;
    const status = fullyRefunded
      ? PaymentStatus.REFUNDED
      : PaymentStatus.PARTIALLY_REFUNDED;

    span.setAttribute('payment.refund_amount', refundAmount);
    span.setAttribute('payment.status', status);

    // Stripe idempotency: same payment + cumulative refunded total = same key.
    const idempotencyKey = `refund_${payment.id}_${Math.round(newRefunded * 100)}`;

    await this.paymentProvider.refundOnline({
      provider: payment.provider,
      providerRef: payment.providerRef,
      amount: refundAmount,
      currency: payment.order.restaurant.currency,
      idempotencyKey,
    });

    // Optimistic concurrency: only succeed if refundedAmount is still what we read.
    const updatedCount = await this.prisma.payment.updateMany({
      where: {
        id,
        refundedAmount: payment.refundedAmount,
        status: {
          in: [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED],
        },
      },
      data: {
        refundedAmount: newRefunded,
        status,
        refundedAt: new Date(),
      },
    });

    if (updatedCount.count !== 1) {
      throw new ConflictException(
        'Payment was modified concurrently — refresh and retry the refund',
      );
    }

    const updated = await this.prisma.payment.findUniqueOrThrow({
      where: { id },
    });

    const response = {
      ...updated,
      currency: payment.order.restaurant.currency,
    };

    this.realtime.publishPaymentUpdated({
      ...response,
      restaurantId: payment.order.restaurantId,
      branchId: payment.order.branchId,
    });

    return response;
  }

  private resolveSplitCover(
    order: {
      items: {
        id: string;
        price: Prisma.Decimal | number;
        quantity: number;
        seatNumber: number | null;
      }[];
      payments: {
        status: PaymentStatus;
        lines: { orderItemId: string }[];
      }[];
    },
    dto: CreatePaymentDto,
    remaining: number,
  ): { cover: number; lines: { orderItemId: string; amount: number }[] } {
    // Split is line-level (whole OrderItem rows), not per-unit quantity.
    const hasItems = (dto.orderItemIds?.length ?? 0) > 0;
    const hasSeats = (dto.seatNumbers?.length ?? 0) > 0;
    if (hasItems && hasSeats) {
      throw new BadRequestException(
        'Provide either orderItemIds or seatNumbers, not both',
      );
    }

    const allocatedIds = new Set<string>();
    for (const payment of order.payments) {
      if (!ALLOCATING_STATUSES.includes(payment.status)) continue;
      for (const line of payment.lines) {
        allocatedIds.add(line.orderItemId);
      }
    }

    let selected = order.items;
    if (hasItems) {
      selected = order.items.filter((item) =>
        dto.orderItemIds!.includes(item.id),
      );
      if (selected.length !== dto.orderItemIds!.length) {
        throw new BadRequestException('One or more order items not found');
      }
    } else if (hasSeats) {
      const seats = new Set(dto.seatNumbers);
      selected = order.items.filter(
        (item) => item.seatNumber != null && seats.has(item.seatNumber),
      );
      if (selected.length === 0) {
        throw new BadRequestException('No items found for those seats');
      }
    } else {
      // Open balance payment — no line allocation required.
      const cover =
        dto.amount != null
          ? Number((Number(dto.amount) - Number(dto.tipAmount ?? 0)).toFixed(2))
          : remaining;
      if (cover <= 0) {
        throw new BadRequestException('Payment cover must be positive');
      }
      if (cover > remaining + 0.001) {
        throw new BadRequestException(
          `Payment exceeds remaining balance (${remaining})`,
        );
      }
      return { cover, lines: [] };
    }

    for (const item of selected) {
      if (allocatedIds.has(item.id)) {
        throw new ConflictException(
          `Item ${item.id} is already allocated to another payment`,
        );
      }
    }

    const lines = selected.map((item) => ({
      orderItemId: item.id,
      amount: lineTotal(item),
    }));
    const cover = Number(
      lines.reduce((sum, line) => sum + line.amount, 0).toFixed(2),
    );
    if (cover <= 0) {
      throw new BadRequestException('Selected items have zero total');
    }
    if (cover > remaining + 0.001) {
      throw new BadRequestException(
        `Selected items exceed remaining balance (${remaining})`,
      );
    }
    return { cover, lines };
  }

  private assertMethodAllowed(method: PaymentMethod | string) {
    if (method === PaymentMethod.ONLINE || method === 'ONLINE') {
      if (!this.paymentProvider.isOnlineEnabled()) {
        throw new BadRequestException(
          'ONLINE payments require PAYMENT_PROVIDER=mock|stripe. Use CASH, CARD (Terminal), or CARD_MANUAL.',
        );
      }
    }
    if (method === PaymentMethod.CARD || method === 'CARD') {
      if (!this.paymentProvider.isTerminalEnabled()) {
        throw new BadRequestException(
          'CARD requires Stripe Terminal. Use CARD_MANUAL for honor-system card, or enable Terminal.',
        );
      }
    }
  }

  /** PENDING_PAYMENT walk-in → NEW when fully paid; fires all courses. */
  private async releaseWalkInToKitchen(
    tx: Prisma.TransactionClient,
    orderId: string,
    mode: OrderMode,
    currentStatus: OrderStatus,
    payments: { amount: unknown; tipAmount?: unknown; refundedAmount?: unknown; status: PaymentStatus | string }[],
    orderTotal: number,
  ): Promise<boolean> {
    if (
      mode !== OrderMode.WALK_IN ||
      currentStatus !== OrderStatus.PENDING_PAYMENT ||
      !isOrderFullyPaid(orderTotal, payments)
    ) {
      return false;
    }

    const now = new Date();
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.NEW,
        items: {
          updateMany: {
            where: { orderId },
            data: { status: OrderStatus.NEW, firedAt: now },
          },
        },
      },
    });

    return true;
  }

  private async emitWalkInReleasedToKitchen(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: orderEventInclude,
    });

    if (!order || order.status !== OrderStatus.NEW) return;

    const { restaurant, ...rest } = order;
    this.realtime.publishOrderCreated({
      ...rest,
      currency: restaurant.currency,
    });
  }

  private async emitOrderCompleted(
    orderId: string,
    previousStatus: OrderStatus,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: orderEventInclude,
    });

    if (!order) return;

    const { restaurant, ...rest } = order;
    this.realtime.publishOrderStatusChanged(
      {
        ...rest,
        currency: restaurant.currency,
      },
      previousStatus,
    );
  }

  private async completeOrderIfServed(
    tx: Prisma.TransactionClient,
    orderId: string,
    tableId: string | null,
    currentStatus: OrderStatus,
    payments: { amount: unknown; tipAmount?: unknown; refundedAmount?: unknown; status: PaymentStatus | string }[],
    orderTotal: number,
  ): Promise<boolean> {
    if (currentStatus === OrderStatus.COMPLETED) {
      return false;
    }

    if (!isOrderFullyPaid(orderTotal, payments)) {
      return false;
    }

    // Walk-in READY stays on the pickup board until staff marks Picked up.
    // Only SERVED (dine-in) auto-completes when payment lands.
    if (currentStatus !== OrderStatus.SERVED) {
      return false;
    }

    await tx.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.COMPLETED,
        items: {
          updateMany: {
            where: { orderId },
            data: { status: OrderStatus.COMPLETED },
          },
        },
      },
    });

    if (!tableId) return true;

    const openCount = await tx.order.count({
      where: {
        tableId,
        status: { in: ACTIVE_ORDER_STATUSES },
      },
    });

    if (openCount === 0) {
      await tx.table.update({
        where: { id: tableId },
        data: { status: TableStatus.AVAILABLE },
      });
    }

    return true;
  }
}
