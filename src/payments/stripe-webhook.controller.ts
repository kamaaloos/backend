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

    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const session = event.data.object;
      const paymentId = session.metadata?.paymentId;
      const providerRef = session.id;

      try {
        if (paymentId) {
          await this.paymentsService.settleOnlineById(paymentId, providerRef);
        } else {
          await this.paymentsService.settleOnlineByProviderRef(providerRef);
        }
      } catch {
        // Acknowledge anyway — missing/local payments should not retry forever.
      }
    }

    return { received: true };
  }
}
