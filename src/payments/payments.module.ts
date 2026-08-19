import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { PaymentProviderService } from './payment-provider';

@Module({
  imports: [PrismaModule, RealtimeModule, ConfigModule, LedgerModule],
  controllers: [PaymentsController, StripeWebhookController],
  providers: [PaymentsService, PaymentProviderService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
