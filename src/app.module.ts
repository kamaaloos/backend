import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RestaurantsModule } from './restaurants/restaurants.module';
import { BranchesModule } from './branches/branches.module';
import { CommonModule } from './common/common.module';
import { TablesModule } from './tables/tables.module';
import { QrModule } from './qr/qr.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { MenuModule } from './menu/menu.module';
import { DevicesModule } from './devices/devices.module';
import { RealtimeModule } from './realtime/realtime.module';
import { CustomerModule } from './customer/customer.module';
import { KitchenDisplayModule } from './kitchen-display/kitchen-display.module';
import { WaiterDisplayModule } from './waiter-display/waiter-display.module';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';
import { RedisThrottlerStorage } from './redis/redis-throttler.storage';
import { UploadsModule } from './uploads/uploads.module';
import { LedgerModule } from './ledger/ledger.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [ConfigService, RedisService],
      useFactory: (config: ConfigService, redis: RedisService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: Number(config.get('THROTTLE_TTL_MS') ?? 60_000),
            limit: Number(config.get('THROTTLE_LIMIT') ?? 120),
          },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    CommonModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    RestaurantsModule,
    BranchesModule,
    TablesModule,
    MenuModule,
    DevicesModule,
    RealtimeModule,
    OrdersModule,
    QrModule,
    PaymentsModule,
    CustomerModule,
    KitchenDisplayModule,
    WaiterDisplayModule,
    UploadsModule,
    LedgerModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
