/// <reference types="jest" />
import { ConfigService } from '@nestjs/config';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
import { PaymentProviderService } from './payment-provider';

describe('PaymentProviderService Terminal', () => {
  function build(env: Record<string, string | undefined>) {
    const config = {
      get: (key: string) => env[key],
    } as ConfigService;
    return new PaymentProviderService(config);
  }

  it('disables terminal unless provider is stripe', () => {
    const svc = build({ PAYMENT_PROVIDER: 'mock', STRIPE_TERMINAL: '1' });
    expect(svc.isTerminalEnabled()).toBe(false);
  });

  it('enables terminal by default when provider is stripe', () => {
    const svc = build({ PAYMENT_PROVIDER: 'stripe' });
    expect(svc.isTerminalEnabled()).toBe(true);
  });

  it('can disable terminal with STRIPE_TERMINAL=0', () => {
    const svc = build({ PAYMENT_PROVIDER: 'stripe', STRIPE_TERMINAL: '0' });
    expect(svc.isTerminalEnabled()).toBe(false);
  });

  it('CARD starts PENDING when terminal is enabled', () => {
    const svc = build({ PAYMENT_PROVIDER: 'stripe' });
    expect(svc.initialStatusFor(PaymentMethod.CARD)).toBe(
      PaymentStatus.PENDING,
    );
  });

  it('CARD throws when terminal is off (use CARD_MANUAL)', () => {
    const svc = build({ PAYMENT_PROVIDER: 'stripe', STRIPE_TERMINAL: 'false' });
    expect(() => svc.initialStatusFor(PaymentMethod.CARD)).toThrow(
      'TERMINAL_REQUIRED',
    );
  });

  it('CARD_MANUAL is always PAID (honor-system)', () => {
    const svc = build({ PAYMENT_PROVIDER: 'stripe', STRIPE_TERMINAL: 'false' });
    expect(svc.initialStatusFor(PaymentMethod.CARD_MANUAL)).toBe(
      PaymentStatus.PAID,
    );
  });

  it('CASH is always PAID from initialStatusFor', () => {
    const svc = build({ PAYMENT_PROVIDER: 'stripe' });
    expect(svc.initialStatusFor(PaymentMethod.CASH)).toBe(PaymentStatus.PAID);
  });

  it('exposes terminalEnabled in public config', () => {
    const svc = build({
      PAYMENT_PROVIDER: 'stripe',
      STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
      STRIPE_TERMINAL_LOCATION_ID: 'tml_test',
    });
    expect(svc.getPublicConfig()).toMatchObject({
      provider: 'stripe',
      onlineEnabled: true,
      terminalEnabled: true,
      terminalLocationId: 'tml_test',
      publishableKey: 'pk_test_x',
    });
  });

  it('returns empty readers without location id', async () => {
    const svc = build({ PAYMENT_PROVIDER: 'stripe', STRIPE_TERMINAL: '1' });
    await expect(svc.listTerminalReaders()).resolves.toEqual([]);
  });
});
