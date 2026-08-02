import {
  mapOrderItems,
  OrderEventItem,
  OrderEventSource,
  toIso,
} from './order-event-source';

export type OrderCreatedEvent = {
  orderId: string;
  restaurantId: string;
  branchId: string;
  tableId: string | null;
  tableNumber: string | null;
  customerName: string | null;
  status: string;
  total: string;
  currency: string;
  items: OrderEventItem[];
  createdAt: string;
};

export function toOrderCreatedEvent(order: OrderEventSource): OrderCreatedEvent {
  return {
    orderId: order.id,
    restaurantId: order.restaurantId,
    branchId: order.branchId,
    tableId: order.tableId,
    tableNumber: order.table?.number ?? null,
    customerName: order.customerName,
    status: order.status,
    total: String(order.total),
    currency: order.currency,
    items: mapOrderItems(order),
    createdAt: toIso(order.createdAt),
  };
}
