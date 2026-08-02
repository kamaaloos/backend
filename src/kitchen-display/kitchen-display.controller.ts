import {
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Body,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { KitchenDisplayService } from './kitchen-display.service';
import { UpdateOrderStatusDto } from '../orders/dto/update-order-status.dto';

@Controller('kitchen')
export class KitchenDisplayController {
  constructor(private readonly kitchenDisplayService: KitchenDisplayService) {}

  @Get('me')
  me(@Headers('x-device-token') deviceToken: string | undefined) {
    return this.kitchenDisplayService.me(deviceToken);
  }

  /** Keep the kitchen tablet ONLINE while idle (no ticket activity). */
  @Post('ping')
  @SkipThrottle()
  ping(@Headers('x-device-token') deviceToken: string | undefined) {
    return this.kitchenDisplayService.ping(deviceToken);
  }

  @Get('tickets')
  tickets(@Headers('x-device-token') deviceToken: string | undefined) {
    return this.kitchenDisplayService.tickets(deviceToken);
  }

  @Get('dashboard')
  dashboard(@Headers('x-device-token') deviceToken: string | undefined) {
    return this.kitchenDisplayService.dashboard(deviceToken);
  }

  @Patch('orders/:id/status')
  updateStatus(
    @Headers('x-device-token') deviceToken: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.kitchenDisplayService.updateStatus(deviceToken, id, dto);
  }
}
