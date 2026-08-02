import { Module } from '@nestjs/common';

import { DevicesModule } from '../devices/devices.module';
import { OrdersModule } from '../orders/orders.module';
import { CustomerModule } from '../customer/customer.module';
import { WaiterDisplayController } from './waiter-display.controller';

@Module({
  imports: [DevicesModule, OrdersModule, CustomerModule],
  controllers: [WaiterDisplayController],
})
export class WaiterDisplayModule {}
