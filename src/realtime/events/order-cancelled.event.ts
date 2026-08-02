import { OrderStatus } from '@prisma/client';

import {
  mapOrderItems,
  OrderEventItem,
  OrderEventSource,
  toIso,
} from './order-event-source';

export type OrderCancelledEvent = {
  orderId: string;
  restaurantId: string;
  branchId: string;
  tableId: string | null;
  tableNumber: string | null;
  customerName: string | null;
  previousStatus: OrderStatus | null;
  status: typeof OrderStatus.CANCELLED;
  total: string;
  currency: string;
  items: OrderEventItem[];
  cancelledAt: string;
};

export function toOrderCancelledEvent(
  order: OrderEventSource,
  previousStatus: OrderStatus | null = null,
): OrderCancelledEvent {
  return {
    orderId: order.id,
    restaurantId: order.restaurantId,
    branchId: order.branchId,
    tableId: order.tableId,
    tableNumber: order.table?.number ?? null,
    customerName: order.customerName,
    previousStatus,
    status: OrderStatus.CANCELLED,
    total: String(order.total),
    currency: order.currency,
    items: mapOrderItems(order),
    cancelledAt: toIso(order.updatedAt),
  };
}
