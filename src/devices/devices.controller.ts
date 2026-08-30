import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';

import { DevicesService } from './devices.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { DeviceHeartbeatDto } from './dto/device-heartbeat.dto';
import { PairDeviceDto } from './dto/pair-device.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  /** Public to devices: authenticate with x-device-token header. */
  @Post('heartbeat')
  heartbeat(
    @Headers('x-device-token') deviceToken: string | undefined,
    @Body() dto: DeviceHeartbeatDto,
  ) {
    if (!deviceToken) {
      throw new UnauthorizedException('x-device-token header is required');
    }

    return this.devicesService.heartbeat(deviceToken, dto);
  }

  /**
   * Public: exchange a one-time pairing code (from Admin QR) for a device token.
   * Tightly rate-limited to slow brute-force of short codes.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('pair')
  pair(@Body() dto: PairDeviceDto) {
    return this.devicesService.exchangePairingCode(dto.code);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
  )
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateDeviceDto) {
    return this.devicesService.create(user, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.WAITER,
    UserRole.CHEF,
    UserRole.CASHIER,
  )
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
  ) {
    return this.devicesService.findAll(user, branchId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.WAITER,
    UserRole.CHEF,
    UserRole.CASHIER,
  )
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.devicesService.findOne(id, user);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
  )
  update(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateDeviceDto,
  ) {
    return this.devicesService.update(id, user, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
  )
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.devicesService.remove(id, user);
  }

  @Post(':id/rotate-token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
  )
  rotateToken(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.devicesService.rotateToken(id, user);
  }

  @Post(':id/pairing-code')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
  )
  issuePairingCode(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.devicesService.issuePairingCode(id, user);
  }

  @Post(':id/revoke')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
  )
  revoke(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.devicesService.revoke(id, user);
  }
}
