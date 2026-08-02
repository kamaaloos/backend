import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DeviceType } from '@prisma/client';

import { DevicesService } from '../devices/devices.service';
import { OrdersService } from '../orders/orders.service';
import { UpdateOrderStatusDto } from '../orders/dto/update-order-status.dto';

const DISPLAY_DEVICE_TYPES: DeviceType[] = [
  DeviceType.KITCHEN,
  DeviceType.MANAGER,
];

@Injectable()
export class KitchenDisplayService {
  constructor(
    private readonly devicesService: DevicesService,
    private readonly ordersService: OrdersService,
  ) {}

  async me(deviceToken: string | undefined) {
    const device = await this.requireKitchenDevice(deviceToken);

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

  /** Heartbeat — refreshes ONLINE + lastSeen without loading tickets. */
  async ping(deviceToken: string | undefined) {
    const device = await this.requireKitchenDevice(deviceToken);

    return {
      id: device.id,
      status: device.status,
      lastSeen: device.lastSeen,
      branchId: device.branchId,
    };
  }

  async tickets(deviceToken: string | undefined) {
    const device = await this.requireKitchenDevice(deviceToken);
    return this.ordersService.findKitchenTicketsForBranch(device.branchId);
  }

  async dashboard(deviceToken: string | undefined) {
    const device = await this.requireKitchenDevice(deviceToken);
    return this.ordersService.getKitchenDashboardForBranch(device.branchId);
  }

  async updateStatus(
    deviceToken: string | undefined,
    orderId: string,
    dto: UpdateOrderStatusDto,
  ) {
    const device = await this.requireKitchenDevice(deviceToken);
    return this.ordersService.updateKitchenStatus(
      orderId,
      dto.status,
      device.branchId,
    );
  }

  private async requireKitchenDevice(deviceToken: string | undefined) {
    if (!deviceToken) {
      throw new UnauthorizedException('x-device-token header is required');
    }

    const device = await this.devicesService.findByToken(deviceToken);

    if (!DISPLAY_DEVICE_TYPES.includes(device.deviceType)) {
      throw new ForbiddenException(
        'Only KITCHEN or MANAGER devices can access the kitchen display',
      );
    }

    const online = await this.devicesService.markOnline(device.id);
    return {
      ...device,
      status: online.status,
      lastSeen: online.lastSeen,
    };
  }
}
