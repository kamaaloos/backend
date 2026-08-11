import { PaymentStatus } from '@prisma/client';

export type PaymentCoverSlice = {
  amount: unknown;
  tipAmount?: unknown;
  refundedAmount?: unknown;
  status: PaymentStatus | string;
};

const ACTIVE_COVER_STATUSES = new Set<string>([
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.PENDING,
]);

const SETTLED_COVER_STATUSES = new Set<string>([
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
]);

/** Portion of a payment that applies toward order.total (excludes tip). */
export function coverAmount(payment: PaymentCoverSlice): number {
  const amount = Number(payment.amount);
  const tip = Number(payment.tipAmount ?? 0);
  return Number(Math.max(0, amount - tip).toFixed(2));
}

/**
 * Settled cover after refunds.
 * Refunds apply tip-first, then to order cover:
 * food €50 + tip €10, refund €10 → cover stays €50.
 */
export function effectiveCover(payment: PaymentCoverSlice): number {
  if (!SETTLED_COVER_STATUSES.has(payment.status)) return 0;
  const tip = Number(payment.tipAmount ?? 0);
  const refunded = Number(payment.refundedAmount ?? 0);
  const cover = coverAmount(payment);
  const coverRefunded = Math.max(0, refunded - tip);
  return Number(Math.max(0, cover - coverRefunded).toFixed(2));
}

/** Cover reserved by PENDING + still-effective settled payments. */
export function reservedCover(payments: PaymentCoverSlice[]): number {
  let total = 0;
  for (const payment of payments) {
    if (!ACTIVE_COVER_STATUSES.has(payment.status)) continue;
    if (payment.status === PaymentStatus.PENDING) {
      total += coverAmount(payment);
    } else {
      total += effectiveCover(payment);
    }
  }
  return Number(total.toFixed(2));
}

export function paidCover(payments: PaymentCoverSlice[]): number {
  return Number(
    payments.reduce((sum, p) => sum + effectiveCover(p), 0).toFixed(2),
  );
}

export function balanceDue(
  orderTotal: number,
  payments: PaymentCoverSlice[],
): number {
  return Number(Math.max(0, Number(orderTotal) - reservedCover(payments)).toFixed(2));
}

export function isOrderFullyPaid(
  orderTotal: number,
  payments: PaymentCoverSlice[],
): boolean {
  return Number(orderTotal) - paidCover(payments) <= 0.001;
}

export function lineTotal(item: {
  price: unknown;
  quantity: number;
}): number {
  return Number((Number(item.price) * item.quantity).toFixed(2));
}
