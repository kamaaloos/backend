import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
import Stripe from 'stripe';

export type PaymentProviderId = 'none' | 'mock' | 'stripe';

export type OnlineCheckoutResult = {
  provider: PaymentProviderId;
  providerRef: string;
  checkoutUrl?: string;
};

/**
 * ONLINE payment gate + Stripe Checkout.
 * - none → ONLINE rejected
 * - mock → ONLINE PENDING (staff markPaid)
 * - stripe → Checkout Session; webhook settles to PAID
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

  getPublicConfig() {
    const provider = this.getProviderId();
    return {
      provider,
      onlineEnabled: provider !== 'none',
      publishableKey:
        provider === 'stripe'
          ? this.config.get<string>('STRIPE_PUBLISHABLE_KEY')?.trim() || null
          : null,
    };
  }

  /** Prefer CUSTOMER_APP_URL, else CORS origin on :3001, else localhost. */
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
   * Initial status for a newly created payment.
   * ONLINE always starts PENDING (async capture / mock confirm).
   */
  initialStatusFor(
    method: PaymentMethod | string,
    requested?: PaymentStatus,
  ): PaymentStatus {
    if (method === PaymentMethod.ONLINE || method === 'ONLINE') {
      if (!this.isOnlineEnabled()) {
        throw new Error('ONLINE_DISABLED');
      }
      return PaymentStatus.PENDING;
    }

    return requested ?? PaymentStatus.PAID;
  }

  /** Create Stripe Checkout Session for an ONLINE payment row. */
  async createOnlineCheckout(input: {
    paymentId: string;
    orderId: string;
    amount: number;
    currency: string;
    tipAmount: number;
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
    const defaultBase =
      this.config.get<string>('STRIPE_SUCCESS_URL')?.trim() ||
      this.config.get<string>('CORS_ORIGIN')?.split(',')[0]?.trim() ||
      'http://localhost:3005';
    const successUrl =
      input.successUrl?.trim() ||
      `${defaultBase.replace(/\/$/, '')}?paid=1&orderId=${input.orderId}`;
    const cancelUrl =
      input.cancelUrl?.trim() ||
      this.config.get<string>('STRIPE_CANCEL_URL')?.trim() ||
      `${defaultBase.replace(/\/$/, '')}?paid=0&orderId=${input.orderId}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: unitAmount,
            product_data: {
              name: `Order ${input.orderId.slice(0, 8)}`,
              description:
                input.tipAmount > 0
                  ? `Includes tip ${input.tipAmount}`
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

  async refundOnline(input: {
    provider: string | null | undefined;
    providerRef: string | null | undefined;
    amount: number;
    currency: string;
  }): Promise<void> {
    if (input.provider !== 'stripe' || !input.providerRef) {
      return;
    }

    const stripe = this.getStripe();
    const session = await stripe.checkout.sessions.retrieve(input.providerRef);
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;

    if (!paymentIntentId) {
      throw new BadRequestException(
        'Cannot refund: Stripe payment intent missing for this session',
      );
    }

    await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: toStripeAmount(input.amount, input.currency.toLowerCase()),
    });
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

/** Convert major currency units to Stripe minor units (cents). */
function toStripeAmount(amount: number, currency: string): number {
  // Zero-decimal currencies (rare for this product); default ×100.
  const zeroDecimal = new Set(['jpy', 'krw', 'vnd']);
  if (zeroDecimal.has(currency)) {
    return Math.round(amount);
  }
  return Math.round(amount * 100);
}
