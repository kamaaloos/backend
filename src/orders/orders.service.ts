import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Course,
  OrderMode,
  OrderStatus,
  PaymentStatus,
  Prisma,
  TableStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateOrderDto } from './dto/create-order.dto';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { nextQueueNumber } from './queue-number.util';
import {
  paymentSloSeconds,
  prepSloSeconds,
  recordPrepDurationMs,
} from '../telemetry/metrics';
import { evaluateSlo, summarizeDurations } from '../telemetry/slo';
import { withSpan } from '../telemetry/tracing';
import { balanceDue, isOrderFullyPaid } from '../payments/payment-balance';
import { firstCoursePresent, nextCourseToFire } from './course.util';

/** Orders visible on the kitchen board. */
const KITCHEN_STATUSES: OrderStatus[] = [
  OrderStatus.NEW,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
];

/** Statuses a kitchen device is allowed to set (never SERVED/COMPLETED). */
const ALLOWED_KITCHEN_STATUSES: OrderStatus[] = [
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
];

const WAITER_ACTIVE_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.NEW,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.SERVED,
];

const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  // Walk-in prepay → NEW is owned by PaymentsService, not status PATCH.
  [OrderStatus.PENDING_PAYMENT]: [OrderStatus.CANCELLED],
  [OrderStatus.NEW]: [OrderStatus.ACCEPTED, OrderStatus.CANCELLED],
  [OrderStatus.ACCEPTED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.READY, OrderStatus.CANCELLED],
  // Walk-in: READY until staff marks Picked up (→ COMPLETED). Dine-in uses SERVED.
  [OrderStatus.READY]: [
    OrderStatus.SERVED,
    OrderStatus.COMPLETED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.SERVED]: [OrderStatus.COMPLETED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
};

const orderInclude = {
  items: {
    include: {
      menuItem: true,
      modifiers: true,
    },
  },
  table: true,
  payments: {
    include: {
      lines: true,
      receivedBy: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  restaurant: {
    select: {
      currency: true,
      taxRatePercent: true,
    },
  },
} satisfies Prisma.OrderInclude;

type OrderWithRelations = Prisma.OrderGetPayload<{
  include: typeof orderInclude;
}>;

type OrderResponse = Omit<OrderWithRelations, 'restaurant'> & {
  currency: string;
  /** Receipt VAT/sales-tax percent (tax-inclusive menu prices). */
  taxRatePercent: number;
  /** Latest PENDING payment, else most recent — FE compat. */
  payment: OrderWithRelations['payments'][number] | null;
  balanceDue: number;
};

export type KitchenTicketResponse = OrderResponse & {
  ageSeconds: number;
  ageMinutes: number;
};

/** Live kitchen service snapshot for managers / KDS header. */
export type KitchenDashboardStats = {
  new: number;
  accepted: number;
  preparing: number;
  ready: number;
  open: number;
  /** Average age of open tickets (minutes). */
  averageWaitMinutes: number;
  /**
   * Avg minutes from preparingAt → readyAt over recent READY/COMPLETED tickets.
   */
  averagePrepTimeMinutes: number | null;
  /** Oldest open ticket age (minutes). */
  longestWaitingMinutes: number;
  /** Prep p95 seconds (4h lookback). */
  prepP95Seconds: number | null;
  /** Payment settle p95 seconds createdAt→paidAt (4h lookback). */
  paymentSettleP95Seconds: number | null;
  /** Avg payment settle seconds (4h lookback). */
  averagePaymentSettleSeconds: number | null;
  prepSlo: 'ok' | 'breach' | 'insufficient_data';
  paymentSlo: 'ok' | 'breach' | 'insufficient_data';
  sloPrepThresholdSeconds: number;
  sloPaymentThresholdSeconds: number;
};

function withCurrency(order: OrderWithRelations): OrderResponse {
  const { restaurant, ...rest } = order;
  const payment =
    rest.payments.find((p) => p.status === PaymentStatus.PENDING) ??
    rest.payments[rest.payments.length - 1] ??
    null;
  return {
    ...rest,
    payment,
    balanceDue: balanceDue(Number(rest.total), rest.payments),
    currency: restaurant.currency,
    taxRatePercent: Number(restaurant.taxRatePercent),
  };
}

function withKitchenAge(
  order: OrderResponse,
  now = Date.now(),
): KitchenTicketResponse {
  const ageSeconds = Math.max(
    0,
    Math.floor((now - new Date(order.createdAt).getTime()) / 1000),
  );
  return {
    ...order,
    ageSeconds,
    ageMinutes: Math.floor(ageSeconds / 60),
  };
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly realtime: RealtimePublisher,
  ) {}

  async create(user: JwtPayload, dto: CreateOrderDto): Promise<OrderResponse> {
    const mode = dto.mode ?? OrderMode.DINE_IN;

    if (mode === OrderMode.WALK_IN) {
      if (dto.tableId) {
        throw new BadRequestException(
          'Walk-in orders cannot be attached to a table',
        );
      }

      const branchId = await this.authorization.resolveBranch(
        user,
        dto.branchId,
      );
      await this.authorization.canAccessBranch(user, branchId);

      const branch = await this.prisma.branch.findUnique({
        where: { id: branchId },
      });
      if (!branch) {
        throw new NotFoundException('Branch not found');
      }

      const restaurantId = user.restaurantId ?? branch.restaurantId;
      if (!restaurantId) {
        throw new BadRequestException(
          'restaurantId could not be resolved for this walk-in order',
        );
      }

      return this.createOrderRecord({
        restaurantId,
        branchId,
        customerName: dto.customerName ?? 'Guest',
        createdById: user.sub,
        items: dto.items,
        mode: OrderMode.WALK_IN,
      });
    }

    const table = await this.loadTable(dto.tableId);

    if (table) {
      await this.authorization.canAccessBranch(user, table.branchId);
    }

    const restaurantId = user.restaurantId ?? table?.branch.restaurantId;
    const branchId =
      user.branchId ??
      (dto.tableId ? table?.branchId : undefined) ??
      dto.branchId ??
      undefined;

    if (!restaurantId || !branchId) {
      throw new BadRequestException(
        'restaurantId/branchId could not be resolved. Provide a tableId or use a tenant user.',
      );
    }

    await this.authorization.canAccessBranch(user, branchId);

    return this.createOrderRecord({
      restaurantId,
      branchId,
      tableId: dto.tableId,
      customerName: dto.customerName,
      createdById: user.sub,
      items: dto.items,
      mode: OrderMode.DINE_IN,
    });
  }

  async findForKitchen(
    user: JwtPayload,
    branchIdQuery?: string,
  ): Promise<KitchenTicketResponse[]> {
    const branchId = await this.authorization.resolveBranch(
      user,
      branchIdQuery,
    );

    return this.findKitchenTicketsForBranch(branchId);
  }

  /** Device-authenticated kitchen display (no user JWT). Oldest ticket first. */
  async findKitchenTicketsForBranch(
    branchId: string,
  ): Promise<KitchenTicketResponse[]> {
    const orders = await this.prisma.order.findMany({
      where: {
        branchId,
        status: { in: KITCHEN_STATUSES },
      },
      include: orderInclude,
      orderBy: { createdAt: 'asc' },
    });

    const now = Date.now();
    return orders
      .map((order) => {
        const firedItems = order.items.filter((item) => item.firedAt != null);
        // Hold tickets with nothing fired yet (waiting on fire-next).
        if (firedItems.length === 0) return null;
        return withKitchenAge(
          withCurrency({ ...order, items: firedItems }),
          now,
        );
      })
      .filter((ticket): ticket is KitchenTicketResponse => ticket != null)
      .sort((a, b) => {
        const rank = (t: KitchenTicketResponse) =>
          (t.isRush ? 2 : 0) + (t.isVip ? 1 : 0);
        const diff = rank(b) - rank(a);
        if (diff !== 0) return diff;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
  }

  async getKitchenDashboard(
    user: JwtPayload,
    branchIdQuery?: string,
  ): Promise<KitchenDashboardStats> {
    const branchId = await this.authorization.resolveBranch(
      user,
      branchIdQuery,
    );
    return this.getKitchenDashboardForBranch(branchId);
  }

  /** Live ticket counts + wait pressure for a branch kitchen. */
  async getKitchenDashboardForBranch(
    branchId: string,
  ): Promise<KitchenDashboardStats> {
    const tickets = await this.prisma.order.findMany({
      where: {
        branchId,
        status: { in: KITCHEN_STATUSES },
      },
      select: {
        status: true,
        createdAt: true,
      },
    });

    const now = Date.now();
    const agesMinutes = tickets.map((ticket) =>
      Math.max(0, Math.floor((now - ticket.createdAt.getTime()) / 60_000)),
    );

    const count = (status: OrderStatus) =>
      tickets.filter((ticket) => ticket.status === status).length;

    const average = (values: number[]) =>
      values.length === 0
        ? 0
        : Math.round(
            values.reduce((sum, value) => sum + value, 0) / values.length,
          );

    const lookback = new Date(now - 4 * 60 * 60 * 1000);
    const prepSamples = await this.prisma.order.findMany({
      where: {
        branchId,
        preparingAt: { not: null, gte: lookback },
        readyAt: { not: null },
        status: {
          in: [
            OrderStatus.READY,
            OrderStatus.SERVED,
            OrderStatus.COMPLETED,
          ],
        },
      },
      select: { preparingAt: true, readyAt: true },
      take: 200,
    });

    const prepSeconds = prepSamples
      .map((row) => {
        if (!row.preparingAt || !row.readyAt) return null;
        return Math.max(
          0,
          (row.readyAt.getTime() - row.preparingAt.getTime()) / 1000,
        );
      })
      .filter((v): v is number => v != null);

    const prepMinutes = prepSeconds.map((s) => Math.floor(s / 60));
    const prepSummary = summarizeDurations(prepSeconds);

    const paySamples = await this.prisma.payment.findMany({
      where: {
        order: { branchId },
        status: PaymentStatus.PAID,
        paidAt: { not: null, gte: lookback },
      },
      select: { createdAt: true, paidAt: true },
      take: 200,
    });

    const paySeconds = paySamples
      .map((row) => {
        if (!row.paidAt) return null;
        return Math.max(
          0,
          (row.paidAt.getTime() - row.createdAt.getTime()) / 1000,
        );
      })
      .filter((v): v is number => v != null);
    const paySummary = summarizeDurations(paySeconds);

    const prepThreshold = prepSloSeconds();
    const payThreshold = paymentSloSeconds();

    return {
      new: count(OrderStatus.NEW),
      accepted: count(OrderStatus.ACCEPTED),
      preparing: count(OrderStatus.PREPARING),
      ready: count(OrderStatus.READY),
      open: tickets.length,
      averageWaitMinutes: average(agesMinutes),
      averagePrepTimeMinutes:
        prepMinutes.length === 0 ? null : average(prepMinutes),
      longestWaitingMinutes:
        agesMinutes.length === 0 ? 0 : Math.max(...agesMinutes),
      prepP95Seconds: prepSummary.p95Seconds,
      paymentSettleP95Seconds: paySummary.p95Seconds,
      averagePaymentSettleSeconds: paySummary.averageSeconds,
      prepSlo: evaluateSlo(prepSummary.p95Seconds, prepThreshold),
      paymentSlo: evaluateSlo(paySummary.p95Seconds, payThreshold),
      sloPrepThresholdSeconds: prepThreshold,
      sloPaymentThresholdSeconds: payThreshold,
    };
  }

  async findForWaiter(
    user: JwtPayload,
    branchIdQuery?: string,
    status?: OrderStatus,
  ): Promise<OrderResponse[]> {
    const branchId = await this.authorization.resolveBranch(
      user,
      branchIdQuery,
    );

    return this.findWaiterOrdersForBranch(branchId, status);
  }

  /**
   * Cashier floor: active tickets plus unpaid COMPLETED (recovery if someone
   * closed a check without settling).
   */
  async findForCashier(
    user: JwtPayload,
    branchIdQuery?: string,
  ): Promise<OrderResponse[]> {
    const branchId = await this.authorization.resolveBranch(
      user,
      branchIdQuery,
    );

    const orders = await this.prisma.order.findMany({
      where: {
        branchId,
        status: {
          in: [...WAITER_ACTIVE_STATUSES, OrderStatus.COMPLETED],
        },
      },
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
    });

    return orders
      .map(withCurrency)
      .filter(
        (order) =>
          order.status !== OrderStatus.COMPLETED || order.balanceDue > 0.001,
      );
  }

  /**
   * Closed checks paid in [from, to) — till history for the cashier day.
   * Defaults to the last 24h UTC if range omitted.
   */
  async findTodayPaidForCashier(
    user: JwtPayload,
    branchIdQuery?: string,
    fromIso?: string,
    toIso?: string,
  ): Promise<OrderResponse[]> {
    const branchId = await this.authorization.resolveBranch(
      user,
      branchIdQuery,
    );

    const now = new Date();
    const from = fromIso ? new Date(fromIso) : new Date(now.getTime() - 86_400_000);
    const to = toIso ? new Date(toIso) : now;

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Invalid from/to datetime');
    }
    if (from >= to) {
      throw new BadRequestException('from must be before to');
    }

    const orders = await this.prisma.order.findMany({
      where: {
        branchId,
        status: OrderStatus.COMPLETED,
        payments: {
          some: {
            status: {
              in: [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED],
            },
            paidAt: { gte: from, lt: to },
          },
        },
      },
      include: orderInclude,
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });

    return orders
      .map(withCurrency)
      .filter((order) =>
        isOrderFullyPaid(Number(order.total), order.payments),
      );
  }

  /** Device-authenticated waiter display (no user JWT). */
  async findWaiterOrdersForBranch(
    branchId: string,
    status?: OrderStatus,
  ): Promise<OrderResponse[]> {
    const orders = await this.prisma.order.findMany({
      where: {
        branchId,
        status: status ? status : { in: WAITER_ACTIVE_STATUSES },
      },
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
    });

    return orders.map(withCurrency);
  }

  async findOne(id: string, user: JwtPayload): Promise<OrderResponse> {
    const order = await this.getOrderOrThrow(id);
    await this.authorization.canAccessBranch(user, order.branchId);
    return withCurrency(order);
  }

  async updateStatus(
    id: string,
    status: OrderStatus,
    user: JwtPayload,
  ): Promise<OrderResponse> {
    const order = await this.getOrderOrThrow(id);
    await this.authorization.canAccessBranch(user, order.branchId);
    return this.applyStatusTransition(order, status);
  }

  /** Device display advances tickets for its branch within allowed targets. */
  async updateStatusForBranch(
    id: string,
    status: OrderStatus,
    branchId: string,
    allowedTargets: OrderStatus[],
  ): Promise<OrderResponse> {
    const order = await this.getOrderOrThrow(id);

    if (order.branchId !== branchId) {
      throw new NotFoundException('Order not found');
    }

    if (!allowedTargets.includes(status)) {
      throw new BadRequestException(
        `This device can only set status to ${allowedTargets.join(', ')}`,
      );
    }

    return this.applyStatusTransition(order, status);
  }

  /** Kitchen device status updates — ACCEPTED → PREPARING → READY only. */
  async updateKitchenStatus(
    id: string,
    status: OrderStatus,
    branchId: string,
  ): Promise<OrderResponse> {
    return this.updateStatusForBranch(
      id,
      status,
      branchId,
      ALLOWED_KITCHEN_STATUSES,
    );
  }

  private async applyStatusTransition(
    order: OrderWithRelations,
    status: OrderStatus,
  ): Promise<OrderResponse> {
    return withSpan(
      'order.status_transition',
      {
        'order.id': order.id,
        'order.branch_id': order.branchId,
        'order.mode': order.mode,
        'order.from_status': order.status,
        'order.to_status': status,
      },
      async (span) => {
        const allowed = STATUS_TRANSITIONS[order.status] ?? [];
        if (!allowed.includes(status)) {
          throw new BadRequestException(
            `Cannot transition from ${order.status} to ${status}`,
          );
        }

        // Dine-in (and walk-in) must be settled before leaving the floor.
        // Otherwise cashier loses the ticket once COMPLETED drops off active boards.
        if (status === OrderStatus.COMPLETED) {
          const paid = isOrderFullyPaid(
            Number(order.total),
            order.payments,
          );
          if (!paid) {
            throw new BadRequestException(
              'Cannot complete order until it is fully paid',
            );
          }
        }

        if (status === OrderStatus.CANCELLED) {
          const settled = order.payments.some(
            (p) =>
              p.status === PaymentStatus.PAID ||
              p.status === PaymentStatus.PARTIALLY_REFUNDED,
          );
          if (settled) {
            throw new BadRequestException(
              'Paid orders cannot be cancelled. Refund the payment instead.',
            );
          }
        }

        const stamp =
          status === OrderStatus.ACCEPTED && !order.acceptedAt
            ? { acceptedAt: new Date() }
            : status === OrderStatus.PREPARING && !order.preparingAt
              ? { preparingAt: new Date() }
              : status === OrderStatus.READY && !order.readyAt
                ? { readyAt: new Date() }
                : status === OrderStatus.SERVED && !order.servedAt
                  ? { servedAt: new Date() }
                  : {};

        const updated = await this.prisma.$transaction(async (tx) => {
          if (status === OrderStatus.CANCELLED) {
            await tx.payment.updateMany({
              where: {
                orderId: order.id,
                status: PaymentStatus.PENDING,
              },
              data: { status: PaymentStatus.VOIDED },
            });
          }

          return tx.order.update({
            where: { id: order.id },
            data: {
              status,
              ...stamp,
              items: {
                updateMany: {
                  where: { orderId: order.id },
                  data: { status },
                },
              },
            },
            include: orderInclude,
          });
        });

        if (
          status === OrderStatus.READY &&
          order.preparingAt &&
          updated.readyAt
        ) {
          const prepMs =
            updated.readyAt.getTime() - order.preparingAt.getTime();
          span.setAttribute('order.prep_duration_ms', prepMs);
          recordPrepDurationMs(prepMs);
        }

        // Dine-in: once served + paid, close the check so it does not sit forever.
        // Walk-in stays READY on the pickup TV until staff marks Picked up (COMPLETED).
        const paid = isOrderFullyPaid(
          Number(updated.total),
          updated.payments,
        );
        if (paid && status === OrderStatus.SERVED) {
          return this.applyStatusTransition(updated, OrderStatus.COMPLETED);
        }

        if (
          status === OrderStatus.COMPLETED ||
          status === OrderStatus.CANCELLED
        ) {
          await this.maybeFreeTable(order.tableId);
        }

        const response = withCurrency(updated);
        this.realtime.publishOrderStatusChanged(response, order.status);
        return response;
      },
    );
  }

  private async createOrderRecord(input: {
    restaurantId: string;
    branchId: string;
    tableId?: string;
    customerName?: string;
    createdById: string | null;
    items: CreateOrderDto['items'];
    mode?: OrderMode;
  }): Promise<OrderResponse> {
    const mode = input.mode ?? OrderMode.DINE_IN;
    const menuItems = await this.prisma.menuItem.findMany({
      where: {
        id: { in: input.items.map((item) => item.menuItemId) },
        active: true,
        available: true,
        restaurantId: input.restaurantId,
      },
    });

    if (menuItems.length !== input.items.length) {
      throw new NotFoundException(
        'One or more menu items not found for this restaurant',
      );
    }

    const isWalkIn = mode === OrderMode.WALK_IN;
    let total = 0;
    const drafted = input.items.map((item) => {
      const menuItem = menuItems.find((m) => m.id === item.menuItemId)!;
      const price = Number(menuItem.price);
      total += price * item.quantity;
      return {
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        price,
        notes: item.notes,
        seatNumber: item.seatNumber ?? null,
        course: item.course ?? Course.MAIN,
        // Walk-in waits for till payment before kitchen release.
        status: isWalkIn ? OrderStatus.PENDING_PAYMENT : OrderStatus.NEW,
      };
    });

    const firstCourse = firstCoursePresent(drafted);
    const now = new Date();
    const orderItems = drafted.map((item) => ({
      ...item,
      // Dine-in: fire first course immediately; later courses wait for fire-next.
      // Walk-in: fire all courses when payment releases the ticket.
      firedAt: isWalkIn
        ? null
        : item.course === firstCourse
          ? now
          : null,
    }));

    const order = await this.prisma.$transaction(async (tx) => {
      const queueNumber = isWalkIn
        ? await nextQueueNumber(tx, input.branchId)
        : null;

      return tx.order.create({
        data: {
          restaurantId: input.restaurantId,
          branchId: input.branchId,
          tableId: input.tableId,
          mode,
          queueNumber,
          customerName: input.customerName,
          createdById: input.createdById,
          total,
          status: isWalkIn ? OrderStatus.PENDING_PAYMENT : OrderStatus.NEW,
          items: { create: orderItems },
        },
        include: orderInclude,
      });
    });

    const response = withCurrency(order);
    this.realtime.publishOrderCreated(response);
    return response;
  }

  /** Release the next held course to the kitchen. */
  async fireNext(id: string, user: JwtPayload): Promise<OrderResponse> {
    const order = await this.getOrderOrThrow(id);
    await this.authorization.canAccessBranch(user, order.branchId);
    return this.fireNextOnOrder(order);
  }

  async fireNextForBranch(
    id: string,
    branchId: string,
  ): Promise<OrderResponse> {
    const order = await this.getOrderOrThrow(id);
    if (order.branchId !== branchId) {
      throw new NotFoundException('Order not found');
    }
    return this.fireNextOnOrder(order);
  }

  private async fireNextOnOrder(
    order: OrderWithRelations,
  ): Promise<OrderResponse> {
    if (
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.COMPLETED ||
      order.status === OrderStatus.PENDING_PAYMENT
    ) {
      throw new BadRequestException(
        `Cannot fire courses on a ${order.status} order`,
      );
    }

    const course = nextCourseToFire(order.items);
    if (!course) {
      throw new BadRequestException('All courses are already fired');
    }

    const now = new Date();
    await this.prisma.orderItem.updateMany({
      where: {
        orderId: order.id,
        course,
        firedAt: null,
      },
      data: { firedAt: now },
    });

    const updated = await this.getOrderOrThrow(order.id);
    const response = withCurrency(updated);
    this.realtime.publishOrderStatusChanged(response, order.status);
    return response;
  }

  private async loadTable(tableId?: string) {
    if (!tableId) return null;

    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
      include: { branch: true },
    });

    if (!table || table.deletedAt) {
      throw new NotFoundException('Table not found');
    }

    return table;
  }

  private async getOrderOrThrow(id: string): Promise<OrderWithRelations> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: orderInclude,
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  private async maybeFreeTable(tableId: string | null | undefined) {
    if (!tableId) return;

    const openCount = await this.prisma.order.count({
      where: {
        tableId,
        status: { in: WAITER_ACTIVE_STATUSES },
      },
    });

    if (openCount === 0) {
      await this.prisma.table.update({
        where: { id: tableId },
        data: { status: TableStatus.AVAILABLE },
      });
    }
  }
}
