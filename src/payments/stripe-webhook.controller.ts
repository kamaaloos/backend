import {
  BadRequestException,
  Controller,
  Headers,
  Post,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { PaymentProviderService } from './payment-provider';
import { PaymentsService } from './payments.service';

@Controller('payments/webhooks')
export class StripeWebhookController {
  constructor(
    private readonly paymentProvider: PaymentProviderService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @SkipThrottle()
  @Post('stripe')
  async handleStripe(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }
    if (!req.rawBody) {
      throw new BadRequestException(
        'Raw body unavailable — enable Nest rawBody for Stripe webhooks',
      );
    }

    const event = this.paymentProvider.constructStripeEvent(
      req.rawBody,
      signature,
    );

    const claimed = await this.paymentsService.claimStripeWebhookEvent(
      event.id,
      event.type,
    );
    if (!claimed) {
      return { received: true, duplicate: true };
    }

    try {
      if (
        event.type === 'checkout.session.completed' ||
        event.type === 'checkout.session.async_payment_succeeded'
      ) {
        const session = event.data.object;
        const paymentId = session.metadata?.paymentId;
        const providerRef = session.id;

        if (paymentId) {
          await this.paymentsService.settleOnlineById(paymentId, providerRef);
        } else {
          await this.paymentsService.settleOnlineByProviderRef(providerRef);
        }
      } else if (event.type === 'payment_intent.succeeded') {
        const intent = event.data.object;
        const paymentId = intent.metadata?.paymentId;
        const providerRef = intent.id;

        if (paymentId) {
          await this.paymentsService.settleOnlineById(paymentId, providerRef);
        } else {
          await this.paymentsService.settleOnlineByProviderRef(providerRef);
        }
      } else if (event.type === 'payment_intent.payment_failed') {
        const intent = event.data.object;
        await this.paymentsService.failPendingByProviderRef(intent.id);
      }
    } catch {
      // Acknowledge anyway — missing/local payments should not retry forever.
      // Event id is already claimed so Stripe retries will short-circuit.
    }

    return { received: true };
  }
}
