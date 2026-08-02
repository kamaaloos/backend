import { PaymentStatus } from '@prisma/client';
import {
  balanceDue,
  isOrderFullyPaid,
  paidCover,
  reservedCover,
} from './payment-balance';

describe('payment-balance', () => {
  it('tracks remaining balance across split payments', () => {
    const payments = [
      {
        amount: 12,
        tipAmount: 2,
        refundedAmount: 0,
        status: PaymentStatus.PAID,
      },
      {
        amount: 8,
        tipAmount: 0,
        refundedAmount: 0,
        status: PaymentStatus.PENDING,
      },
    ];
    expect(paidCover(payments)).toBe(10);
    expect(reservedCover(payments)).toBe(18);
    expect(balanceDue(30, payments)).toBe(12);
    expect(isOrderFullyPaid(30, payments)).toBe(false);
  });

  it('treats refunds as releasing cover', () => {
    const payments = [
      {
        amount: 20,
        tipAmount: 0,
        refundedAmount: 5,
        status: PaymentStatus.PARTIALLY_REFUNDED,
      },
    ];
    expect(paidCover(payments)).toBe(15);
    expect(isOrderFullyPaid(15, payments)).toBe(true);
  });
});
