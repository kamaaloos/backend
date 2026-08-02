import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { DeviceType, OrderStatus } from '@prisma/client';

import { DevicesService } from '../devices/devices.service';
import { OrdersService } from '../orders/orders.service';
import { UpdateOrderStatusDto } from '../orders/dto/update-order-status.dto';
import { CustomerService } from '../customer/customer.service';

const WAITER_DEVICE_TYPES: DeviceType[] = [
  DeviceType.WAITER,
  DeviceType.MANAGER,
];

const WAITER_STATUS_TARGETS: OrderStatus[] = [
  OrderStatus.SERVED,
  OrderStatus.COMPLETED,
];

@Controller('waiter')
export class WaiterDisplayController {
  constructor(
    private readonly devicesService: DevicesService,
    private readonly ordersService: OrdersService,
    private readonly customerService: CustomerService,
  ) {}

  @Get('me')
  async me(@Headers('x-device-token') deviceToken: string | undefined) {
    const device = await this.requireWaiterDevice(deviceToken);

    return {
      id: device.id,
      name: device.name,
      deviceType: device.deviceType,
      status: device.status,
      branchId: device.branchId,
      restaurantId: device.branch.restaurantId,
      branchName: device.branch.name,
      lastSeen: device.lastSeen,
      appVersion: device.appVersion,
    };
  }

  @Get('orders')
  async orders(@Headers('x-device-token') deviceToken: string | undefined) {
    const device = await this.requireWaiterDevice(deviceToken);
    await this.devicesService.markOnline(device.id);
    return this.ordersService.findWaiterOrdersForBranch(device.branchId);
  }

  @Patch('orders/:id/status')
  async updateStatus(
    @Headers('x-device-token') deviceToken: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    const device = await this.requireWaiterDevice(deviceToken);
    return this.ordersService.updateStatusForBranch(
      id,
      dto.status,
      device.branchId,
      WAITER_STATUS_TARGETS,
    );
  }

  @Post('orders/:id/fire-next')
  async fireNext(
    @Headers('x-device-token') deviceToken: string | undefined,
    @Param('id') id: string,
  ) {
    const device = await this.requireWaiterDevice(deviceToken);
    return this.ordersService.fireNextForBranch(id, device.branchId);
  }

  @Get('service-requests')
  async serviceRequests(
    @Headers('x-device-token') deviceToken: string | undefined,
  ) {
    const device = await this.requireWaiterDevice(deviceToken);
    return this.customerService.listServiceRequestsForStaff(device.branchId);
  }

  @Patch('service-requests/:id/acknowledge')
  async acknowledge(
    @Headers('x-device-token') deviceToken: string | undefined,
    @Param('id') id: string,
  ) {
    const device = await this.requireWaiterDevice(deviceToken);
    return this.customerService.acknowledgeServiceRequest(id, device.branchId);
  }

  @Patch('service-requests/:id/complete')
  async complete(
    @Headers('x-device-token') deviceToken: string | undefined,
    @Param('id') id: string,
  ) {
    const device = await this.requireWaiterDevice(deviceToken);
    return this.customerService.completeServiceRequest(id, device.branchId);
  }

  private async requireWaiterDevice(deviceToken: string | undefined) {
    if (!deviceToken) {
      throw new UnauthorizedException('x-device-token header is required');
    }

    const device = await this.devicesService.findByToken(deviceToken);

    if (!WAITER_DEVICE_TYPES.includes(device.deviceType)) {
      throw new ForbiddenException(
        'Only WAITER or MANAGER devices can access the waiter display',
      );
    }

    return device;
  }
}
