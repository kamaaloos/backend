import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
import Stripe from 'stripe';

import { toStripeAmount, type MoneyInput } from './stripe-amount';
import { Decimal } from '@prisma/client/runtime/library';

export type PaymentProviderId = 'none' | 'mock' | 'stripe';

export type OnlineCheckoutResult = {
  provider: PaymentProviderId;
  providerRef: string;
  checkoutUrl?: string;
};

export type CardPresentIntentResult = {
  provider: 'stripe';
  providerRef: string;
  clientSecret: string;
};

/**
 * ONLINE: Checkout (mock markPaid | stripe session + webhook).
 * CARD: Stripe Terminal only (PaymentIntent + webhook). Never honor-system.
 * CARD_MANUAL: Explicit till honor-system card (immediate PAID).
 * CASH: staff create as PAID / pending-cash + markPaid.
 * Reporting uses Payment.channel (CASH | TERMINAL | ONLINE | COUNTER).
 */
@Injectable()
export class PaymentProviderService {
  private readonly logger = new Logger(PaymentProviderService.name);
  private stripe: Stripe | null = null;

  constructor(private readonly config: ConfigService) {}

  getProviderId(): PaymentProviderId {
    const raw = (this.config.get<string>('PAYMENT_PROVIDER') ?? 'none')
      .trim()
      .toLowerCase();
    if (raw === 'mock') return 'mock';
    if (raw === 'stripe') return 'stripe';
    return 'none';
  }

  isOnlineEnabled() {
    return this.getProviderId() !== 'none';
  }

  /**
   * Card-present via Stripe Terminal.
   * On when PAYMENT_PROVIDER=stripe and STRIPE_TERMINAL is not 0/false.
   */
  isTerminalEnabled() {
    if (this.getProviderId() !== 'stripe') return false;
    const raw = (this.config.get<string>('STRIPE_TERMINAL') ?? '1')
      .trim()
      .toLowerCase();
    return raw !== '0' && raw !== 'false' && raw !== 'off';
  }

  getPublicConfig() {
    const provider = this.getProviderId();
    const terminalEnabled = this.isTerminalEnabled();
    const locationId =
      this.config.get<string>('STRIPE_TERMINAL_LOCATION_ID')?.trim() || null;
    return {
      provider,
      onlineEnabled: provider !== 'none',
      terminalEnabled,
      terminalLocationId: terminalEnabled ? locationId : null,
      publishableKey:
        provider === 'stripe'
          ? this.config.get<string>('STRIPE_PUBLISHABLE_KEY')?.trim() || null
          : null,
    };
  }

  customerAppUrl() {
    const explicit = this.config.get<string>('CUSTOMER_APP_URL')?.trim();
    if (explicit) return explicit.replace(/\/$/, '');
    const cors = this.config.get<string>('CORS_ORIGIN') ?? '';
    const hit = cors
      .split(',')
      .map((s) => s.trim())
      .find((s) => s.includes(':3001'));
    return (hit || 'http://localhost:3001').replace(/\/$/, '');
  }

  cashierAppUrl() {
    const explicit = this.config.get<string>('CASHIER_APP_URL')?.trim();
    if (explicit) return explicit.replace(/\/$/, '');
    const cors = this.config.get<string>('CORS_ORIGIN') ?? '';
    const hit = cors
      .split(',')
      .map((s) => s.trim())
      .find((s) => s.includes(':3005'));
    return (hit || 'http://localhost:3005').replace(/\/$/, '');
  }

  /**
   * Server-owned initial status. Clients never choose PAID/PENDING.
   * CARD requires Terminal — use CARD_MANUAL for honor-system till card.
   */
  initialStatusFor(method: PaymentMethod | string): PaymentStatus {
    if (method === PaymentMethod.ONLINE || method === 'ONLINE') {
      if (!this.isOnlineEnabled()) {
        throw new Error('ONLINE_DISABLED');
      }
      return PaymentStatus.PENDING;
    }

    if (method === PaymentMethod.CARD || method === 'CARD') {
      if (!this.isTerminalEnabled()) {
        throw new Error('TERMINAL_REQUIRED');
      }
      return PaymentStatus.PENDING;
    }

    // CASH, CARD_MANUAL
    return PaymentStatus.PAID;
  }

  async createOnlineCheckout(input: {
    paymentId: string;
    orderId: string;
    amount: MoneyInput;
    currency: string;
    tipAmount: MoneyInput;
    successUrl?: string;
    cancelUrl?: string;
  }): Promise<OnlineCheckoutResult> {
    const provider = this.getProviderId();
    if (provider === 'mock') {
      return {
        provider: 'mock',
        providerRef: `mock_${input.paymentId}`,
      };
    }
    if (provider !== 'stripe') {
      throw new BadRequestException('ONLINE provider is not configured');
    }

    const stripe = this.getStripe();
    const currency = input.currency.toLowerCase();
    const unitAmount = toStripeAmount(input.amount, currency);

    const successUrl = input.successUrl?.trim();
    const cancelUrl =
      input.cancelUrl?.trim() ||
      this.config.get<string>('STRIPE_CANCEL_URL')?.trim() ||
      undefined;
    const fallbackSuccess = this.config
      .get<string>('STRIPE_SUCCESS_URL')
      ?.trim();

    const resolvedSuccess =
      successUrl ||
      (fallbackSuccess
        ? `${fallbackSuccess.replace(/\/$/, '')}?paid=1&orderId=${input.orderId}`
        : undefined);
    const resolvedCancel =
      cancelUrl ||
      (fallbackSuccess
        ? `${fallbackSuccess.replace(/\/$/, '')}?paid=0&orderId=${input.orderId}`
        : undefined);

    if (!resolvedSuccess || !resolvedCancel) {
      throw new BadRequestException(
        'Checkout redirect URLs required: pass successUrl/cancelUrl or set STRIPE_SUCCESS_URL (and optionally STRIPE_CANCEL_URL)',
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: resolvedSuccess,
      cancel_url: resolvedCancel,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: unitAmount,
            product_data: {
              name: `Order ${input.orderId.slice(0, 8)}`,
              description: new Decimal(input.tipAmount as Decimal.Value).gt(0)
                ? `Includes tip ${String(input.tipAmount)}`
                : 'Restaurant order',
            },
          },
        },
      ],
      metadata: {
        paymentId: input.paymentId,
        orderId: input.orderId,
      },
      payment_intent_data: {
        metadata: {
          paymentId: input.paymentId,
          orderId: input.orderId,
        },
      },
    });

    if (!session.url) {
      throw new BadRequestException('Stripe did not return a checkout URL');
    }

    return {
      provider: 'stripe',
      providerRef: session.id,
      checkoutUrl: session.url,
    };
  }

  async createTerminalConnectionToken(): Promise<{ secret: string }> {
    if (!this.isTerminalEnabled()) {
      throw new BadRequestException('Stripe Terminal is not enabled');
    }
    const location = this.config
      .get<string>('STRIPE_TERMINAL_LOCATION_ID')
      ?.trim();
    const token = await this.getStripe().terminal.connectionTokens.create(
      location ? { location } : undefined,
    );
    if (!token.secret) {
      throw new BadRequestException('Stripe did not return a connection token');
    }
    return { secret: token.secret };
  }

  /** Registered readers at STRIPE_TERMINAL_LOCATION_ID (empty if unset). */
  async listTerminalReaders(): Promise<
    Array<{
      id: string;
      label: string | null;
      status: string;
      deviceType: string | null;
      serialNumber: string | null;
    }>
  > {
    if (!this.isTerminalEnabled()) {
      throw new BadRequestException('Stripe Terminal is not enabled');
    }
    const location = this.config
      .get<string>('STRIPE_TERMINAL_LOCATION_ID')
      ?.trim();
    if (!location) {
      return [];
    }
    const listed = await this.getStripe().terminal.readers.list({
      location,
      limit: 50,
    });
    return listed.data.map((r) => ({
      id: r.id,
      label: r.label ?? null,
      status: r.status ?? 'unknown',
      deviceType: r.device_type ?? null,
      serialNumber: r.serial_number ?? null,
    }));
  }

  async registerTerminalReader(input: {
    registrationCode: string;
    label: string;
  }): Promise<{ id: string; label: string | null; status: string }> {
    if (!this.isTerminalEnabled()) {
      throw new BadRequestException('Stripe Terminal is not enabled');
    }
    const location = this.config
      .get<string>('STRIPE_TERMINAL_LOCATION_ID')
      ?.trim();
    if (!location) {
      throw new BadRequestException(
        'STRIPE_TERMINAL_LOCATION_ID is required to register a reader',
      );
    }
    const reader = await this.getStripe().terminal.readers.create({
      registration_code: input.registrationCode.trim(),
      label: input.label.trim(),
      location,
    });
    return {
      id: reader.id,
      label: reader.label ?? null,
      status: reader.status ?? 'unknown',
    };
  }

  async createCardPresentIntent(input: {
    paymentId: string;
    orderId: string;
    amount: MoneyInput;
    currency: string;
    tipAmount: MoneyInput;
  }): Promise<CardPresentIntentResult> {
    if (!this.isTerminalEnabled()) {
      throw new BadRequestException('Stripe Terminal is not enabled');
    }

    const stripe = this.getStripe();
    const currency = input.currency.toLowerCase();
    const intent = await stripe.paymentIntents.create({
      amount: toStripeAmount(input.amount, currency),
      currency,
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      metadata: {
        paymentId: input.paymentId,
        orderId: input.orderId,
        tipAmount: String(input.tipAmount),
      },
    });

    if (!intent.client_secret) {
      throw new BadRequestException(
        'Stripe did not return a PaymentIntent client secret',
      );
    }

    return {
      provider: 'stripe',
      providerRef: intent.id,
      clientSecret: intent.client_secret,
    };
  }

  /** Used after Terminal processPayment so local/pilot need not wait on webhooks. */
  async retrievePaymentIntentStatus(providerRef: string) {
    if (this.getProviderId() !== 'stripe') {
      throw new BadRequestException('Stripe is not configured');
    }
    const intent = await this.getStripe().paymentIntents.retrieve(providerRef);
    return {
      id: intent.id,
      status: intent.status,
    };
  }

  async refundOnline(input: {
    provider: string | null | undefined;
    providerRef: string | null | undefined;
    amount: MoneyInput;
    currency: string;
    idempotencyKey?: string;
  }): Promise<void> {
    if (input.provider !== 'stripe' || !input.providerRef) {
      return;
    }

    const stripe = this.getStripe();
    const ref = input.providerRef;
    let paymentIntentId: string | undefined;

    if (ref.startsWith('pi_')) {
      paymentIntentId = ref;
    } else if (ref.startsWith('cs_')) {
      const session = await stripe.checkout.sessions.retrieve(ref);
      paymentIntentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id;
    } else {
      throw new BadRequestException(
        'Cannot refund: unrecognized Stripe provider reference',
      );
    }

    if (!paymentIntentId) {
      throw new BadRequestException(
        'Cannot refund: Stripe payment intent missing for this session',
      );
    }

    await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: toStripeAmount(input.amount, input.currency.toLowerCase()),
      },
      input.idempotencyKey
        ? { idempotencyKey: input.idempotencyKey }
        : undefined,
    );
  }

  constructStripeEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET')?.trim();
    if (!secret) {
      throw new BadRequestException('STRIPE_WEBHOOK_SECRET is not configured');
    }
    return this.getStripe().webhooks.constructEvent(rawBody, signature, secret);
  }

  private getStripe(): Stripe {
    if (this.stripe) return this.stripe;
    const key = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
    if (!key) {
      throw new BadRequestException(
        'STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe',
      );
    }
    this.stripe = new Stripe(key);
    this.logger.log('Stripe client initialized');
    return this.stripe;
  }
}
