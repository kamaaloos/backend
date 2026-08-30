/// <reference types="jest" />
import { Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PaymentProviderService } from './payment-provider';

describe('PaymentsService claimStripeWebhookEvent', () => {
  const authorization = { canAccessBranch: jest.fn() };
  const realtime = {
    publishPaymentUpdated: jest.fn(),
    publishOrderStatusChanged: jest.fn(),
  };
  const paymentProvider = {} as PaymentProviderService;

  it('returns true on first insert', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'evt_1', type: 'x' });
    const service = new PaymentsService(
      { stripeWebhookEvent: { create } } as never,
      authorization as never,
      realtime as never,
      paymentProvider,
    );
    await expect(
      service.claimStripeWebhookEvent('evt_1', 'payment_intent.succeeded'),
    ).resolves.toBe(true);
    expect(create).toHaveBeenCalledWith({
      data: { id: 'evt_1', type: 'payment_intent.succeeded' },
    });
  });

  it('returns false on duplicate event id', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const create = jest.fn().mockRejectedValue(err);
    const service = new PaymentsService(
      { stripeWebhookEvent: { create } } as never,
      authorization as never,
      realtime as never,
      paymentProvider,
    );
    await expect(
      service.claimStripeWebhookEvent('evt_1', 'payment_intent.succeeded'),
    ).resolves.toBe(false);
  });
});
