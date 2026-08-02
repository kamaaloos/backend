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
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentProviderService } from './payment-provider';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import type { Span } from '@opentelemetry/api';
import { withSpan } from '../telemetry/tracing';
import {
  balanceDue,
  isOrderFullyPaid,
  lineTotal,
} from './payment-balance';

type PaymentResponse = Payment & {
  currency: string;
  checkoutUrl?: string;
};

const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.NEW,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.SERVED,
];

const ALLOCATING_STATUSES: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
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
  ) {}

  getProviderConfig() {
    return this.paymentProvider.getPublicConfig();
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

  private async createInner(
    user: JwtPayload,
    dto: CreatePaymentDto,
    span: Span,
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
    try {
      status = this.paymentProvider.initialStatusFor(dto.method, dto.status);
    } catch {
      throw new BadRequestException(
        'ONLINE payments require PAYMENT_PROVIDER=mock|stripe. Use CASH or CARD.',
      );
    }
    const paidAt = status === PaymentStatus.PAID ? new Date() : null;
    const isOnline = dto.method === PaymentMethod.ONLINE;

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          amount,
          tipAmount,
          method: dto.method,
          status,
          paidAt,
          provider: isOnline ? this.paymentProvider.getProviderId() : null,
          lines: lines.length
            ? {
                create: lines.map((line) => ({
                  orderItemId: line.orderItemId,
                  amount: line.amount,
                })),
              }
            : undefined,
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
          order.mode,
          payments,
          Number(order.total),
        );
      }

      return { payment, completed, releasedToKitchen };
    });

    let payment = result.payment;
    let checkoutUrl: string | undefined;
    if (isOnline) {
      const cashier = this.paymentProvider.cashierAppUrl();
      const checkout = await this.paymentProvider.createOnlineCheckout({
        paymentId: payment.id,
        orderId: order.id,
        amount,
        currency: order.restaurant.currency,
        tipAmount,
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
    }

    span.setAttribute('payment.status', status);
    span.setAttribute('payment.amount', amount);
    span.setAttribute('payment.tip_amount', tipAmount);
    span.setAttribute('payment.cover', cover);

    const response: PaymentResponse = {
      ...payment,
      currency: order.restaurant.currency,
      checkoutUrl,
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
        amount,
        currency: order.restaurant.currency,
        tipAmount: 0,
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

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          amount,
          tipAmount: 0,
          method,
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
        payments: { orderBy: { createdAt: 'asc' } },
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

    if (
      payment.method === PaymentMethod.ONLINE &&
      payment.provider === 'stripe'
    ) {
      throw new BadRequestException(
        'Stripe ONLINE payments settle via webhook (checkout.session.completed). Use mock provider for manual markPaid.',
      );
    }

    return this.settlePendingPayment(payment);
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
        payment.order.mode,
        payments,
        Number(payment.order.total),
      );

      return { payment: paid, completed, releasedToKitchen };
    });

    const response = {
      ...result.payment,
      currency,
    };

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
    if (refundAmount <= 0) {
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

    await this.paymentProvider.refundOnline({
      provider: payment.provider,
      providerRef: payment.providerRef,
      amount: refundAmount,
      currency: payment.order.restaurant.currency,
    });

    const updated = await this.prisma.payment.update({
      where: { id },
      data: {
        refundedAmount: newRefunded,
        status,
        refundedAt: new Date(),
      },
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
          'ONLINE payments require PAYMENT_PROVIDER=mock|stripe. Use CASH or CARD.',
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
    mode: OrderMode,
    payments: { amount: unknown; tipAmount?: unknown; refundedAmount?: unknown; status: PaymentStatus | string }[],
    orderTotal: number,
  ): Promise<boolean> {
    if (currentStatus === OrderStatus.COMPLETED) {
      return false;
    }

    if (!isOrderFullyPaid(orderTotal, payments)) {
      return false;
    }

    const canComplete =
      currentStatus === OrderStatus.SERVED ||
      (currentStatus === OrderStatus.READY && mode === OrderMode.WALK_IN);

    if (!canComplete) {
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
