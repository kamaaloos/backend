import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PaymentsModule } from '../payments/payments.module';
import { DevicesModule } from '../devices/devices.module';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { TablePresenceService } from './table-presence.service';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RealtimeModule,
    PaymentsModule,
    DevicesModule,
  ],
  controllers: [CustomerController],
  providers: [CustomerService, TablePresenceService],
  exports: [CustomerService],
})
export class CustomerModule {}
