import {
  PaymentEventSource,
  toIso,
} from './order-event-source';

export type PaymentUpdatedEvent = {
  paymentId: string;
  orderId: string;
  restaurantId: string;
  branchId: string;
  amount: string;
  currency: string;
  method: string;
  status: string;
  paidAt: string | null;
  updatedAt: string;
};

export function toPaymentUpdatedEvent(
  payment: PaymentEventSource,
): PaymentUpdatedEvent {
  return {
    paymentId: payment.id,
    orderId: payment.orderId,
    restaurantId: payment.restaurantId,
    branchId: payment.branchId,
    amount: String(payment.amount),
    currency: payment.currency,
    method: payment.method,
    status: payment.status,
    paidAt: payment.paidAt ? toIso(payment.paidAt) : null,
    updatedAt: toIso(payment.updatedAt),
  };
}
