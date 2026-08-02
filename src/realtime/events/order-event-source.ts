import { OrderMode, OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';

/** Minimal order shape needed to build realtime DTOs. */
export type OrderEventSource = {
  id: string;
  restaurantId: string;
  branchId: string;
  tableId: string | null;
  mode?: OrderMode | string;
  queueNumber?: number | null;
  customerName: string | null;
  status: OrderStatus;
  total: { toString(): string } | string | number;
  currency: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  table?: { number: string } | null;
  items?: Array<{
    id: string;
    quantity: number;
    notes: string | null;
    status: OrderStatus;
    menuItem?: { name: string } | null;
  }>;
};

export type PaymentEventSource = {
  id: string;
  orderId: string;
  amount: { toString(): string } | string | number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt: Date | string | null;
  updatedAt: Date | string;
  restaurantId: string;
  branchId: string;
};

export type OrderEventItem = {
  id: string;
  name: string;
  quantity: number;
  notes: string | null;
  status: OrderStatus;
};

export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function mapOrderItems(order: OrderEventSource): OrderEventItem[] {
  return (order.items ?? []).map((item) => ({
    id: item.id,
    name: item.menuItem?.name ?? 'Item',
    quantity: item.quantity,
    notes: item.notes,
    status: item.status,
  }));
}
