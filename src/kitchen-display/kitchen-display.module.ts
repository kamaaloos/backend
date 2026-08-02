import { Module } from '@nestjs/common';

import { DevicesModule } from '../devices/devices.module';
import { OrdersModule } from '../orders/orders.module';
import { KitchenDisplayController } from './kitchen-display.controller';
import { KitchenDisplayService } from './kitchen-display.service';

@Module({
  imports: [DevicesModule, OrdersModule],
  controllers: [KitchenDisplayController],
  providers: [KitchenDisplayService],
  exports: [KitchenDisplayService],
})
export class KitchenDisplayModule {}
