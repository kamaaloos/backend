import { PaymentChannel, PaymentMethod } from '@prisma/client';

/**
 * Resolve reporting channel from payment method.
 * Orthogonal to `provider` / `providerRef` (PSP identity).
 */
export function resolvePaymentChannel(
  method: PaymentMethod | string,
): PaymentChannel {
  if (method === PaymentMethod.ONLINE || method === 'ONLINE') {
    return PaymentChannel.ONLINE;
  }
  if (method === PaymentMethod.CARD || method === 'CARD') {
    return PaymentChannel.TERMINAL;
  }
  if (method === PaymentMethod.CARD_MANUAL || method === 'CARD_MANUAL') {
    return PaymentChannel.COUNTER;
  }
  return PaymentChannel.CASH;
}
