import { OrderMode, OrderStatus } from '@prisma/client';

import { OrderEventSource, toIso } from './order-event-source';

export type PickupBoardEntry = {
  orderId: string;
  queueNumber: number;
  status: string;
  customerName: string | null;
  updatedAt: string;
};

export type PickupBoardEvent = {
  restaurantId: string;
  branchId: string;
  orderId: string;
  queueNumber: number;
  status: string;
  previousStatus: string | null;
  column: 'preparing' | 'ready' | 'off';
  customerName: string | null;
  updatedAt: string;
};

/** Map walk-in status to TV column; NEW / terminal = off board. */
export function pickupColumn(
  status: OrderStatus | string,
): 'preparing' | 'ready' | 'off' {
  if (status === OrderStatus.ACCEPTED || status === OrderStatus.PREPARING) {
    return 'preparing';
  }
  if (status === OrderStatus.READY) {
    return 'ready';
  }
  return 'off';
}

export function toPickupBoardEvent(
  order: OrderEventSource,
  previousStatus: OrderStatus | null = null,
): PickupBoardEvent | null {
  if (order.mode !== OrderMode.WALK_IN && order.mode !== 'WALK_IN') {
    return null;
  }
  if (order.queueNumber == null) {
    return null;
  }

  return {
    restaurantId: order.restaurantId,
    branchId: order.branchId,
    orderId: order.id,
    queueNumber: order.queueNumber,
    status: order.status,
    previousStatus,
    column: pickupColumn(order.status),
    customerName: order.customerName,
    updatedAt: toIso(order.updatedAt),
  };
}
