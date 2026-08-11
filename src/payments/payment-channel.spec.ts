/// <reference types="jest" />
import { PaymentChannel, PaymentMethod } from '@prisma/client';
import { resolvePaymentChannel } from './payment-channel';

describe('resolvePaymentChannel', () => {
  it('maps CASH to CASH', () => {
    expect(resolvePaymentChannel(PaymentMethod.CASH)).toBe(PaymentChannel.CASH);
  });

  it('maps ONLINE to ONLINE', () => {
    expect(resolvePaymentChannel(PaymentMethod.ONLINE)).toBe(
      PaymentChannel.ONLINE,
    );
  });

  it('maps CARD to TERMINAL', () => {
    expect(resolvePaymentChannel(PaymentMethod.CARD)).toBe(
      PaymentChannel.TERMINAL,
    );
  });

  it('maps CARD_MANUAL to COUNTER', () => {
    expect(resolvePaymentChannel(PaymentMethod.CARD_MANUAL)).toBe(
      PaymentChannel.COUNTER,
    );
  });
});
