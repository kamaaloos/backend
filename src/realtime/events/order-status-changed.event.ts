import { OrderStatus } from '@prisma/client';

import {
  mapOrderItems,
  OrderEventItem,
  OrderEventSource,
  toIso,
} from './order-event-source';

export type OrderStatusChangedEvent = {
  orderId: string;
  restaurantId: string;
  branchId: string;
  tableId: string | null;
  tableNumber: string | null;
  customerName: string | null;
  previousStatus: OrderStatus | null;
  status: OrderStatus;
  total: string;
  currency: string;
  items: OrderEventItem[];
  updatedAt: string;
};

export function toOrderStatusChangedEvent(
  order: OrderEventSource,
  previousStatus: OrderStatus | null = null,
): OrderStatusChangedEvent {
  return {
    orderId: order.id,
    restaurantId: order.restaurantId,
    branchId: order.branchId,
    tableId: order.tableId,
    tableNumber: order.table?.number ?? null,
    customerName: order.customerName,
    previousStatus,
    status: order.status,
    total: String(order.total),
    currency: order.currency,
    items: mapOrderItems(order),
    updatedAt: toIso(order.updatedAt),
  };
}
