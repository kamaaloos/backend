import { PaymentStatus } from '@prisma/client';
import {
  balanceDue,
  effectiveCover,
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

  it('treats cover-only refunds as releasing cover', () => {
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

  it('applies refunds tip-first then to order cover', () => {
    const payment = {
      amount: 60,
      tipAmount: 10,
      refundedAmount: 10,
      status: PaymentStatus.PARTIALLY_REFUNDED,
    };
    // tip €10 refunded first → food cover stays €50
    expect(effectiveCover(payment)).toBe(50);
    expect(paidCover([payment])).toBe(50);
    expect(isOrderFullyPaid(50, [payment])).toBe(true);
  });

  it('reduces cover only after tip is fully refunded', () => {
    const payment = {
      amount: 60,
      tipAmount: 10,
      refundedAmount: 15,
      status: PaymentStatus.PARTIALLY_REFUNDED,
    };
    // €10 tip + €5 cover refunded → cover €45
    expect(effectiveCover(payment)).toBe(45);
  });
});
