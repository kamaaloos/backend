import {
  mapOrderItems,
  OrderEventSource,
  toIso,
} from './order-event-source';

/** Slim payload for customer-facing displays. */
export type CustomerOrderEvent = {
  orderId: string;
  restaurantId: string;
  branchId: string;
  tableNumber: string | null;
  status: string;
  total: string;
  currency: string;
  itemCount: number;
  updatedAt: string;
};

export function toCustomerOrderEvent(
  order: OrderEventSource,
): CustomerOrderEvent {
  const items = mapOrderItems(order);
  return {
    orderId: order.id,
    restaurantId: order.restaurantId,
    branchId: order.branchId,
    tableNumber: order.table?.number ?? null,
    status: order.status,
    total: String(order.total),
    currency: order.currency,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    updatedAt: toIso(order.updatedAt),
  };
}
