import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { randomUUID } from 'crypto';

import { RealtimeGateway } from './realtime.gateway';
import { RedisService } from '../redis/redis.service';
import { RealtimeRoomKind } from './rooms';
import {
  REALTIME_EVENT_VERSION,
  RealtimeEnvelope,
} from './events/event-envelope';
import { RealtimeEvents } from './events/realtime-events';
import {
  OrderEventSource,
  PaymentEventSource,
} from './events/order-event-source';
import { toOrderCreatedEvent } from './events/order-created.event';
import { toOrderStatusChangedEvent } from './events/order-status-changed.event';
import { toOrderCancelledEvent } from './events/order-cancelled.event';
import { toKitchenTicketEvent } from './events/kitchen-ticket.event';
import { toCustomerOrderEvent } from './events/customer-order.event';
import { toPaymentUpdatedEvent } from './events/payment-updated.event';
import { toPickupBoardEvent } from './events/pickup-board.event';
import { ServiceRequestEvent } from './events/service-request.event';

/**
 * Domain services publish here — not directly to Socket.IO.
 * Later this can fan out to Kafka/NATS while the gateway stays a consumer.
 */
@Injectable()
export class RealtimePublisher {
  /** Monotonic sequence per restaurant+branch for reconnect ordering. */
  private readonly sequences = new Map<string, number>();

  constructor(
    private readonly gateway: RealtimeGateway,
    private readonly redis: RedisService,
  ) {}

  publishOrderCreated(order: OrderEventSource) {
    const created = toOrderCreatedEvent(order);
    const ticket = toKitchenTicketEvent(order);
    const customer = toCustomerOrderEvent(order);

    // Walk-in prepay: cashier sees unpaid cart; kitchen waits until PAID → NEW.
    if (order.status === OrderStatus.PENDING_PAYMENT) {
      this.publish(
        order.restaurantId,
        order.branchId,
        ['cashier'],
        RealtimeEvents.ORDER_CREATED,
        created,
      );
      return;
    }

    this.publish(
      order.restaurantId,
      order.branchId,
      ['kitchen', 'waiter'],
      RealtimeEvents.ORDER_CREATED,
      created,
    );
    this.publish(
      order.restaurantId,
      order.branchId,
      ['kitchen'],
      RealtimeEvents.KITCHEN_TICKET,
      ticket,
    );
    this.publishToTableCustomer(
      order.restaurantId,
      order.branchId,
      order.tableId,
      RealtimeEvents.CUSTOMER_ORDER,
      customer,
    );
    this.publishPickupBoard(order, null);
  }

  publishOrderStatusChanged(
    order: OrderEventSource,
    previousStatus: OrderStatus | null = null,
  ) {
    if (order.status === OrderStatus.CANCELLED) {
      this.publishOrderCancelled(order, previousStatus);
      return;
    }

    const statusChanged = toOrderStatusChangedEvent(order, previousStatus);
    const ticket = toKitchenTicketEvent(order);
    const customer = toCustomerOrderEvent(order);

    this.publish(
      order.restaurantId,
      order.branchId,
      ['kitchen', 'waiter', 'cashier'],
      RealtimeEvents.ORDER_STATUS_CHANGED,
      statusChanged,
    );
    this.publish(
      order.restaurantId,
      order.branchId,
      ['kitchen'],
      RealtimeEvents.KITCHEN_TICKET,
      ticket,
    );
    this.publishToTableCustomer(
      order.restaurantId,
      order.branchId,
      order.tableId,
      RealtimeEvents.CUSTOMER_ORDER,
      customer,
    );
    this.publishPickupBoard(order, previousStatus);
  }

  publishOrderCancelled(
    order: OrderEventSource,
    previousStatus: OrderStatus | null = null,
  ) {
    const cancelled = toOrderCancelledEvent(order, previousStatus);
    const customer = toCustomerOrderEvent(order);

    this.publish(
      order.restaurantId,
      order.branchId,
      ['kitchen', 'waiter', 'cashier'],
      RealtimeEvents.ORDER_CANCELLED,
      cancelled,
    );
    this.publishToTableCustomer(
      order.restaurantId,
      order.branchId,
      order.tableId,
      RealtimeEvents.ORDER_CANCELLED,
      cancelled,
    );
    this.publishToTableCustomer(
      order.restaurantId,
      order.branchId,
      order.tableId,
      RealtimeEvents.CUSTOMER_ORDER,
      customer,
    );
    this.publishPickupBoard(order, previousStatus);
  }

  publishPaymentUpdated(payment: PaymentEventSource) {
    const payload = toPaymentUpdatedEvent(payment);
    this.publish(
      payment.restaurantId,
      payment.branchId,
      ['waiter', 'cashier'],
      RealtimeEvents.PAYMENT_UPDATED,
      payload,
    );
  }

  publishServiceRequestCreated(event: ServiceRequestEvent) {
    this.publish(
      event.restaurantId,
      event.branchId,
      ['waiter', 'cashier'],
      RealtimeEvents.SERVICE_REQUEST_CREATED,
      event,
    );
    this.publishToTableCustomer(
      event.restaurantId,
      event.branchId,
      event.tableId,
      RealtimeEvents.SERVICE_REQUEST_CREATED,
      event,
    );
  }

  publishServiceRequestUpdated(event: ServiceRequestEvent) {
    this.publish(
      event.restaurantId,
      event.branchId,
      ['waiter', 'cashier'],
      RealtimeEvents.SERVICE_REQUEST_UPDATED,
      event,
    );
    this.publishToTableCustomer(
      event.restaurantId,
      event.branchId,
      event.tableId,
      RealtimeEvents.SERVICE_REQUEST_UPDATED,
      event,
    );
  }

  private publishPickupBoard(
    order: OrderEventSource,
    previousStatus: OrderStatus | null,
  ) {
    const event = toPickupBoardEvent(order, previousStatus);
    if (!event) return;

    this.publish(
      order.restaurantId,
      order.branchId,
      ['pickup'],
      RealtimeEvents.PICKUP_BOARD,
      event,
    );
  }

  private publishToTableCustomer<T>(
    restaurantId: string,
    branchId: string,
    tableId: string | null | undefined,
    type: string,
    data: T,
  ) {
    if (!tableId) return;

    void this.buildEnvelope(restaurantId, branchId, type, data).then(
      (envelope) => {
        this.gateway.emitToTable(
          restaurantId,
          branchId,
          tableId,
          type,
          envelope,
        );
        // Branch customer-display devices still listen on the shared customer room.
        this.gateway.emitEnvelope(
          restaurantId,
          branchId,
          ['customer'],
          type,
          envelope,
        );
      },
    );
  }

  private publish<T>(
    restaurantId: string,
    branchId: string,
    rooms: RealtimeRoomKind[],
    type: string,
    data: T,
  ) {
    void this.buildEnvelope(restaurantId, branchId, type, data).then(
      (envelope) => {
        this.gateway.emitEnvelope(
          restaurantId,
          branchId,
          rooms,
          type,
          envelope,
        );
      },
    );
  }

  private async buildEnvelope<T>(
    restaurantId: string,
    branchId: string,
    type: string,
    data: T,
  ): Promise<RealtimeEnvelope<T>> {
    return {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      version: REALTIME_EVENT_VERSION,
      sequence: await this.nextSequence(restaurantId, branchId),
      type,
      data,
    };
  }

  private async nextSequence(
    restaurantId: string,
    branchId: string,
  ): Promise<number> {
    const key = `realtime:seq:${restaurantId}:${branchId}`;
    const fromRedis = await this.redis.incr(key);
    if (fromRedis != null) return fromRedis;

    const memKey = `${restaurantId}:${branchId}`;
    const next = (this.sequences.get(memKey) ?? 0) + 1;
    this.sequences.set(memKey, next);
    return next;
  }
}
