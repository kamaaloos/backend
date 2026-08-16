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
  ServiceRequestStatus,
  TableStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { DevicesService } from '../devices/devices.service';
import { PlaceCustomerOrderDto } from './dto/place-customer-order.dto';
import { CreateServiceRequestDto } from './dto/create-service-request.dto';
import { assertQrTokenValid } from '../tables/qr-token.util';
import { nextQueueNumber } from '../orders/queue-number.util';
import { firstCoursePresent } from '../orders/course.util';
import { balanceDue } from '../payments/payment-balance';

function resolveBrandBackgrounds(restaurant: {
  brandBackgroundUrl?: string | null;
  brandBackgroundUrls?: string[] | null;
}): string[] {
  const fromGallery = (restaurant.brandBackgroundUrls ?? [])
    .map((u) => u?.trim())
    .filter((u): u is string => !!u);
  if (fromGallery.length) return fromGallery;
  const single = restaurant.brandBackgroundUrl?.trim();
  return single ? [single] : [];
}

function withPaymentCompat<
  T extends {
    total: unknown;
    payments: {
      status: PaymentStatus | string;
      amount: unknown;
      tipAmount?: unknown;
      refundedAmount?: unknown;
    }[];
  },
>(order: T, currency: string) {
  const payment =
    order.payments.find((p) => p.status === PaymentStatus.PENDING) ??
    order.payments[order.payments.length - 1] ??
    null;
  return {
    ...order,
    payment,
    balanceDue: balanceDue(Number(order.total), order.payments),
    currency,
  };
}

const TRACKABLE_STATUSES: OrderStatus[] = [
  OrderStatus.NEW,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.SERVED,
];

const PICKUP_PREPARING: OrderStatus[] = [
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
];

const menuInclude = {
  where: { active: true },
  orderBy: { displayOrder: 'asc' as const },
  include: {
    menuItems: {
      where: { active: true },
      orderBy: { name: 'asc' as const },
      include: {
        modifierGroups: {
          orderBy: { displayOrder: 'asc' as const },
          include: {
            options: {
              where: { active: true },
              orderBy: { displayOrder: 'asc' as const },
            },
          },
        },
      },
    },
  },
};

@Injectable()
export class CustomerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimePublisher,
    private readonly devicesService: DevicesService,
  ) {}

  /** Scan QR → browse menu with categories + modifiers. */
  async getMenu(token: string) {
    const table = await this.resolveTable(token);

    return {
      restaurant: {
        id: table.branch.restaurant.id,
        name: table.branch.restaurant.name,
        logoUrl: table.branch.restaurant.logoUrl,
        currency: table.branch.restaurant.currency,
        brandAccent: table.branch.restaurant.brandAccent,
        brandButton: table.branch.restaurant.brandButton,
        brandPaper: table.branch.restaurant.brandPaper,
        brandBackgroundUrl: table.branch.restaurant.brandBackgroundUrl,
        brandBackgroundUrls: resolveBrandBackgrounds(table.branch.restaurant),
      },
      branch: {
        id: table.branch.id,
        name: table.branch.name,
      },
      table: {
        id: table.id,
        number: table.number,
        seats: table.seats,
        status: table.status,
        qrToken: table.qrToken ?? table.qrCode,
      },
      categories: table.branch.restaurant.categories,
      capabilities: {
        callWaiter: true,
        requestBill: true,
        liveTracking: true,
      },
    };
  }

  /** Walk-in: browse menu by opaque walk-in token (not branch UUID). */
  async getWalkInMenu(walkInToken: string) {
    const branch = await this.resolveWalkInBranch(walkInToken);

    return {
      restaurant: {
        id: branch.restaurant.id,
        name: branch.restaurant.name,
        logoUrl: branch.restaurant.logoUrl,
        currency: branch.restaurant.currency,
        brandAccent: branch.restaurant.brandAccent,
        brandButton: branch.restaurant.brandButton,
        brandPaper: branch.restaurant.brandPaper,
        brandBackgroundUrl: branch.restaurant.brandBackgroundUrl,
        brandBackgroundUrls: resolveBrandBackgrounds(branch.restaurant),
      },
      branch: {
        id: branch.id,
        name: branch.name,
      },
      table: null,
      categories: branch.restaurant.categories,
      capabilities: {
        callWaiter: false,
        requestBill: false,
        liveTracking: true,
      },
      mode: OrderMode.WALK_IN,
    };
  }

  async listWalkInBranches() {
    // Public directory disabled — guests use QR / direct /w and /t links only.
    return [];
  }

  /** Resolve restaurant tenant for subdomain hosts (alhuda.maylesoft.com). */
  async getTenantBySlug(slug: string) {
    const normalized = slug.trim().toLowerCase();
    if (!normalized || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) {
      throw new NotFoundException('Restaurant not found');
    }

    const restaurant = await this.prisma.restaurant.findFirst({
      where: { slug: normalized, active: true },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        currency: true,
        brandAccent: true,
        brandButton: true,
        brandPaper: true,
        brandBackgroundUrl: true,
        brandBackgroundUrls: true,
        branches: {
          where: { active: true },
          select: {
            id: true,
            name: true,
            walkInToken: true,
          },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    return {
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        slug: restaurant.slug,
        logoUrl: restaurant.logoUrl,
        currency: restaurant.currency,
        brandAccent: restaurant.brandAccent,
        brandButton: restaurant.brandButton,
        brandPaper: restaurant.brandPaper,
        brandBackgroundUrl: restaurant.brandBackgroundUrl,
        brandBackgroundUrls: resolveBrandBackgrounds(restaurant),
      },
      branches: restaurant.branches.map((b) => ({
        id: b.id,
        name: b.name,
        walkInToken: b.walkInToken,
      })),
    };
  }

  async getMenuItem(token: string, menuItemId: string) {
    const table = await this.resolveTable(token);

    const item = await this.prisma.menuItem.findFirst({
      where: {
        id: menuItemId,
        restaurantId: table.branch.restaurantId,
        active: true,
      },
      include: {
        category: true,
        modifierGroups: {
          orderBy: { displayOrder: 'asc' },
          include: {
            options: {
              where: { active: true },
              orderBy: { displayOrder: 'asc' },
            },
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('Menu item not found');
    }

    return {
      currency: table.branch.restaurant.currency,
      item,
    };
  }

  /** Cart lives on the client — this places the full cart as one order. */
  async placeOrder(token: string, dto: PlaceCustomerOrderDto) {
    const table = await this.resolveTable(token);
    return this.createCustomerOrder({
      restaurantId: table.branch.restaurantId,
      branchId: table.branchId,
      tableId: table.id,
      currency: table.branch.restaurant.currency,
      mode: OrderMode.DINE_IN,
      dto,
      occupyTable: table.status === TableStatus.AVAILABLE ? table.id : null,
    });
  }

  async placeWalkInOrder(walkInToken: string, dto: PlaceCustomerOrderDto) {
    const branch = await this.resolveWalkInBranch(walkInToken);
    return this.createCustomerOrder({
      restaurantId: branch.restaurantId,
      branchId: branch.id,
      tableId: null,
      currency: branch.restaurant.currency,
      mode: OrderMode.WALK_IN,
      dto,
      occupyTable: null,
    });
  }

  async listOrders(token: string) {
    const table = await this.resolveTable(token);

    const orders = await this.prisma.order.findMany({
      where: {
        tableId: table.id,
        status: { in: TRACKABLE_STATUSES },
      },
      include: {
        items: {
          include: {
            menuItem: true,
            modifiers: true,
          },
        },
        payments: true,
        restaurant: { select: { currency: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return orders.map(({ restaurant, ...order }) =>
      withPaymentCompat(order, restaurant.currency),
    );
  }

  async getOrder(token: string, orderId: string) {
    const table = await this.resolveTable(token);

    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        tableId: table.id,
      },
      include: {
        items: {
          include: {
            menuItem: true,
            modifiers: true,
          },
        },
        payments: true,
        table: true,
        restaurant: { select: { currency: true } },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found for this table');
    }

    const { restaurant, ...rest } = order;
    return {
      ...withPaymentCompat(rest, restaurant.currency),
      tracking: {
        status: order.status,
        steps: [
          OrderStatus.NEW,
          OrderStatus.ACCEPTED,
          OrderStatus.PREPARING,
          OrderStatus.READY,
          OrderStatus.SERVED,
          OrderStatus.COMPLETED,
        ],
      },
    };
  }

  async getWalkInOrder(walkInToken: string, orderId: string) {
    const branch = await this.resolveWalkInBranch(walkInToken);

    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        branchId: branch.id,
        mode: OrderMode.WALK_IN,
      },
      include: {
        items: {
          include: {
            menuItem: true,
            modifiers: true,
          },
        },
        payments: true,
        restaurant: { select: { currency: true } },
      },
    });

    if (!order) {
      throw new NotFoundException('Walk-in order not found');
    }

    const { restaurant, ...rest } = order;
    return {
      ...withPaymentCompat(rest, restaurant.currency),
      tracking: {
        status: order.status,
        steps: [
          OrderStatus.PENDING_PAYMENT,
          OrderStatus.NEW,
          OrderStatus.ACCEPTED,
          OrderStatus.PREPARING,
          OrderStatus.READY,
          OrderStatus.COMPLETED,
        ],
      },
    };
  }

  async cancelWalkInOrder(walkInToken: string, orderId: string) {
    const branch = await this.resolveWalkInBranch(walkInToken);
    return this.cancelCustomerOrder({
      where: {
        id: orderId,
        branchId: branch.id,
        mode: OrderMode.WALK_IN,
      },
    });
  }

  async cancelTableOrder(token: string, orderId: string) {
    const table = await this.resolveTable(token);
    return this.cancelCustomerOrder({
      where: {
        id: orderId,
        tableId: table.id,
      },
    });
  }

  /**
   * Overhead TV board (device-authenticated): Preparing / Ready.
   * NEW / PENDING_PAYMENT orders are excluded until kitchen accepts.
   */
  async getPickupBoard(walkInToken: string, deviceToken?: string) {
    const branch = await this.resolveWalkInBranch(walkInToken);
    await this.devicesService.requirePickupDisplay(deviceToken, branch.id);

    const orders = await this.prisma.order.findMany({
      where: {
        branchId: branch.id,
        mode: OrderMode.WALK_IN,
        status: {
          in: [...PICKUP_PREPARING, OrderStatus.READY],
        },
        queueNumber: { not: null },
      },
      select: {
        id: true,
        queueNumber: true,
        status: true,
        customerName: true,
        updatedAt: true,
      },
      orderBy: [{ queueNumber: 'asc' }],
    });

    const preparing = orders
      .filter((o) => PICKUP_PREPARING.includes(o.status))
      .map((o) => ({
        orderId: o.id,
        queueNumber: o.queueNumber!,
        status: o.status,
        customerName: o.customerName,
        updatedAt: o.updatedAt,
      }));

    const ready = orders
      .filter((o) => o.status === OrderStatus.READY)
      .map((o) => ({
        orderId: o.id,
        queueNumber: o.queueNumber!,
        status: o.status,
        customerName: o.customerName,
        updatedAt: o.updatedAt,
      }));

    return {
      branch: { id: branch.id, name: branch.name },
      restaurant: {
        id: branch.restaurant.id,
        name: branch.restaurant.name,
        logoUrl: branch.restaurant.logoUrl,
        brandAccent: branch.restaurant.brandAccent,
        brandButton: branch.restaurant.brandButton,
        brandPaper: branch.restaurant.brandPaper,
        brandBackgroundUrl: branch.restaurant.brandBackgroundUrl,
        brandBackgroundUrls: resolveBrandBackgrounds(branch.restaurant),
      },
      preparing,
      ready,
    };
  }

  async createServiceRequest(token: string, dto: CreateServiceRequestDto) {
    const table = await this.resolveTable(token);

    if (dto.orderId) {
      const order = await this.prisma.order.findFirst({
        where: { id: dto.orderId, tableId: table.id },
      });
      if (!order) {
        throw new BadRequestException('Order does not belong to this table');
      }
    }

    const pending = await this.prisma.serviceRequest.findFirst({
      where: {
        tableId: table.id,
        type: dto.type,
        status: {
          in: [ServiceRequestStatus.PENDING, ServiceRequestStatus.ACKNOWLEDGED],
        },
      },
    });

    if (pending) {
      throw new BadRequestException(
        `A ${dto.type} request is already open for this table`,
      );
    }

    const request = await this.prisma.serviceRequest.create({
      data: {
        restaurantId: table.branch.restaurantId,
        branchId: table.branchId,
        tableId: table.id,
        orderId: dto.orderId,
        type: dto.type,
        note: dto.note,
        status: ServiceRequestStatus.PENDING,
      },
      include: {
        table: true,
      },
    });

    this.realtime.publishServiceRequestCreated({
      requestId: request.id,
      restaurantId: request.restaurantId,
      branchId: request.branchId,
      tableId: request.tableId,
      tableNumber: request.table.number,
      orderId: request.orderId,
      type: request.type,
      status: request.status,
      note: request.note,
      createdAt: request.createdAt.toISOString(),
    });

    return request;
  }

  /** Public: open call-waiter / request-bill for this table QR. */
  async listOpenServiceRequestsForTable(token: string) {
    const table = await this.resolveTable(token);
    return this.prisma.serviceRequest.findMany({
      where: {
        tableId: table.id,
        status: {
          in: [ServiceRequestStatus.PENDING, ServiceRequestStatus.ACKNOWLEDGED],
        },
      },
      select: {
        id: true,
        type: true,
        status: true,
        note: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listServiceRequestsForStaff(branchId: string) {
    return this.prisma.serviceRequest.findMany({
      where: {
        branchId,
        status: {
          in: [ServiceRequestStatus.PENDING, ServiceRequestStatus.ACKNOWLEDGED],
        },
      },
      include: { table: true, order: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async acknowledgeServiceRequest(id: string, branchId: string) {
    return this.updateServiceRequestStatus(
      id,
      branchId,
      ServiceRequestStatus.ACKNOWLEDGED,
    );
  }

  async completeServiceRequest(id: string, branchId: string) {
    return this.updateServiceRequestStatus(
      id,
      branchId,
      ServiceRequestStatus.COMPLETED,
    );
  }

  /**
   * Guest self-cancel: only before kitchen acceptance, and only if unpaid.
   * PENDING_PAYMENT (walk-in) or NEW (dine-in / unpaid).
   */
  private async cancelCustomerOrder(input: {
    where: {
      id: string;
      branchId?: string;
      tableId?: string | null;
      mode?: OrderMode;
    };
  }) {
    const order = await this.prisma.order.findFirst({
      where: input.where,
      include: {
        items: {
          include: {
            menuItem: true,
            modifiers: true,
          },
        },
        payments: true,
        table: true,
        restaurant: { select: { currency: true } },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (
      order.status !== OrderStatus.PENDING_PAYMENT &&
      order.status !== OrderStatus.NEW
    ) {
      throw new BadRequestException(
        'This order can no longer be cancelled. Ask staff for help.',
      );
    }

    const settled = order.payments.some(
      (p) =>
        p.status === PaymentStatus.PAID ||
        p.status === PaymentStatus.PARTIALLY_REFUNDED,
    );
    if (settled) {
      throw new BadRequestException(
        'Paid orders cannot be cancelled here. Ask staff for a refund.',
      );
    }

    const previousStatus = order.status;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: {
          orderId: order.id,
          status: PaymentStatus.PENDING,
        },
        data: { status: PaymentStatus.VOIDED },
      });

      const cancelled = await tx.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.CANCELLED,
          items: {
            updateMany: {
              where: { orderId: order.id },
              data: { status: OrderStatus.CANCELLED },
            },
          },
        },
        include: {
          items: {
            include: {
              menuItem: true,
              modifiers: true,
            },
          },
          payments: true,
          table: true,
          restaurant: { select: { currency: true } },
        },
      });

      if (order.tableId) {
        const stillActive = await tx.order.count({
          where: {
            tableId: order.tableId,
            status: {
              in: [
                OrderStatus.PENDING_PAYMENT,
                OrderStatus.NEW,
                OrderStatus.ACCEPTED,
                OrderStatus.PREPARING,
                OrderStatus.READY,
                OrderStatus.SERVED,
              ],
            },
          },
        });
        if (stillActive === 0) {
          await tx.table.update({
            where: { id: order.tableId },
            data: { status: TableStatus.AVAILABLE },
          });
        }
      }

      return cancelled;
    });

    const { restaurant, ...rest } = updated;
    const response = withPaymentCompat(rest, restaurant.currency);
    this.realtime.publishOrderStatusChanged(
      { ...rest, currency: restaurant.currency },
      previousStatus,
    );
    return response;
  }

  private async createCustomerOrder(input: {
    restaurantId: string;
    branchId: string;
    tableId: string | null;
    currency: string;
    mode: OrderMode;
    dto: PlaceCustomerOrderDto;
    occupyTable: string | null;
  }) {
    if (input.dto.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    const menuItemIds = [...new Set(input.dto.items.map((i) => i.menuItemId))];
    const menuItems = await this.prisma.menuItem.findMany({
      where: {
        id: { in: menuItemIds },
        restaurantId: input.restaurantId,
        active: true,
        available: true,
      },
      include: {
        modifierGroups: {
          include: {
            options: { where: { active: true } },
          },
        },
      },
    });

    if (menuItems.length !== menuItemIds.length) {
      throw new NotFoundException('One or more menu items are unavailable');
    }

    const drafted = input.dto.items.map((line) => {
      const menuItem = menuItems.find((m) => m.id === line.menuItemId)!;
      const modifiers = this.resolveModifiers(
        menuItem,
        line.modifierOptionIds ?? [],
      );
      const unitPrice =
        Number(menuItem.price) +
        modifiers.reduce((sum, m) => sum + m.priceDelta, 0);

      return {
        menuItemId: menuItem.id,
        quantity: line.quantity,
        notes: line.notes,
        price: unitPrice,
        seatNumber: line.seatNumber ?? null,
        course: line.course ?? Course.MAIN,
        status:
          input.mode === OrderMode.WALK_IN
            ? OrderStatus.PENDING_PAYMENT
            : OrderStatus.NEW,
        modifiers: {
          create: modifiers.map((m) => ({
            optionId: m.optionId,
            groupName: m.groupName,
            optionName: m.optionName,
            priceDelta: m.priceDelta,
          })),
        },
      };
    });

    const firstCourse = firstCoursePresent(drafted);
    const firedAt = new Date();
    const builtItems = drafted.map((item) => ({
      ...item,
      // Walk-in: fire on kitchen release (payment). Dine-in: fire first course now.
      firedAt:
        input.mode === OrderMode.WALK_IN
          ? null
          : item.course === firstCourse
            ? firedAt
            : null,
    }));

    const total = builtItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );

    const order = await this.prisma.$transaction(async (tx) => {
      const queueNumber =
        input.mode === OrderMode.WALK_IN
          ? await nextQueueNumber(tx, input.branchId)
          : null;

      const created = await tx.order.create({
        data: {
          restaurantId: input.restaurantId,
          branchId: input.branchId,
          tableId: input.tableId,
          mode: input.mode,
          queueNumber,
          customerName: input.dto.customerName ?? 'Guest',
          isRush: input.dto.isRush === true,
          isVip: input.dto.isVip === true,
          createdById: null,
          total,
          // Walk-in must prepay before kitchen sees the ticket.
          status:
            input.mode === OrderMode.WALK_IN
              ? OrderStatus.PENDING_PAYMENT
              : OrderStatus.NEW,
          items: { create: builtItems },
        },
        include: {
          items: {
            include: {
              menuItem: true,
              modifiers: true,
            },
          },
          table: true,
          payments: true,
          restaurant: { select: { currency: true } },
        },
      });

      if (input.occupyTable) {
        await tx.table.update({
          where: { id: input.occupyTable },
          data: { status: TableStatus.OCCUPIED },
        });
      }

      return created;
    });

    const { restaurant, ...rest } = order;
    const response = withPaymentCompat(rest, restaurant.currency);
    this.realtime.publishOrderCreated(response);
    return response;
  }

  private async updateServiceRequestStatus(
    id: string,
    branchId: string,
    status: ServiceRequestStatus,
  ) {
    const existing = await this.prisma.serviceRequest.findFirst({
      where: { id, branchId },
      include: { table: true },
    });

    if (!existing) {
      throw new NotFoundException('Service request not found');
    }

    const updated = await this.prisma.serviceRequest.update({
      where: { id },
      data: {
        status,
        acknowledgedAt:
          status === ServiceRequestStatus.ACKNOWLEDGED
            ? new Date()
            : existing.acknowledgedAt,
        completedAt:
          status === ServiceRequestStatus.COMPLETED ? new Date() : null,
      },
      include: { table: true },
    });

    this.realtime.publishServiceRequestUpdated({
      requestId: updated.id,
      restaurantId: updated.restaurantId,
      branchId: updated.branchId,
      tableId: updated.tableId,
      tableNumber: updated.table.number,
      orderId: updated.orderId,
      type: updated.type,
      status: updated.status,
      note: updated.note,
      createdAt: updated.createdAt.toISOString(),
    });

    return updated;
  }

  private resolveModifiers(
    menuItem: {
      name: string;
      modifierGroups: Array<{
        id: string;
        name: string;
        minSelect: number;
        maxSelect: number;
        required: boolean;
        options: Array<{
          id: string;
          name: string;
          priceDelta: { toString(): string } | number;
        }>;
      }>;
    },
    optionIds: string[],
  ) {
    const optionMap = new Map(
      menuItem.modifierGroups.flatMap((g) =>
        g.options.map((o) => [o.id, { group: g, option: o }] as const),
      ),
    );

    for (const id of optionIds) {
      if (!optionMap.has(id)) {
        throw new BadRequestException(
          `Invalid modifier option for ${menuItem.name}`,
        );
      }
    }

    for (const group of menuItem.modifierGroups) {
      const selected = optionIds.filter((id) =>
        group.options.some((o) => o.id === id),
      );
      const min = group.required
        ? Math.max(group.minSelect, 1)
        : group.minSelect;

      if (selected.length < min) {
        throw new BadRequestException(
          `Select at least ${min} option(s) for "${group.name}"`,
        );
      }
      if (selected.length > group.maxSelect) {
        throw new BadRequestException(
          `Select at most ${group.maxSelect} option(s) for "${group.name}"`,
        );
      }
    }

    return optionIds.map((id) => {
      const hit = optionMap.get(id)!;
      return {
        optionId: hit.option.id,
        groupName: hit.group.name,
        optionName: hit.option.name,
        priceDelta: Number(hit.option.priceDelta),
      };
    });
  }

  /** Resolve public walk-in routes by opaque token (not branch UUID). */
  async resolveWalkInBranch(walkInToken: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { walkInToken, active: true },
      include: {
        restaurant: {
          include: {
            categories: menuInclude,
          },
        },
      },
    });

    if (!branch || !branch.restaurant.active) {
      throw new NotFoundException('Walk-in link not found');
    }

    return branch;
  }

  private async resolveTable(token: string) {
    const table = await this.prisma.table.findFirst({
      where: {
        OR: [{ qrToken: token }, { qrCode: token }],
        deletedAt: null,
        active: true,
      },
      include: {
        branch: {
          include: {
            restaurant: {
              include: {
                categories: menuInclude,
              },
            },
          },
        },
      },
    });

    if (!table) {
      throw new NotFoundException('Invalid QR code');
    }

    assertQrTokenValid(table);

    return table;
  }
}
