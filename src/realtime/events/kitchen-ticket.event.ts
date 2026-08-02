import {
  mapOrderItems,
  OrderEventSource,
  toIso,
} from './order-event-source';

export type KitchenTicketEvent = {
  orderId: string;
  restaurantId: string;
  branchId: string;
  tableNumber: string | null;
  mode?: string;
  queueNumber?: number | null;
  customerName: string | null;
  status: string;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    notes: string | null;
  }>;
  updatedAt: string;
};

export function toKitchenTicketEvent(
  order: OrderEventSource,
): KitchenTicketEvent {
  return {
    orderId: order.id,
    restaurantId: order.restaurantId,
    branchId: order.branchId,
    tableNumber: order.table?.number ?? null,
    mode: order.mode ?? 'DINE_IN',
    queueNumber: order.queueNumber ?? null,
    customerName: order.customerName,
    status: order.status,
    items: mapOrderItems(order).map(({ id, name, quantity, notes }) => ({
      id,
      name,
      quantity,
      notes,
    })),
    updatedAt: toIso(order.updatedAt),
  };
}
