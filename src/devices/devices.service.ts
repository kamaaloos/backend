import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { DeviceStatus, DeviceType } from '@prisma/client';
import { randomUUID } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { DeviceHeartbeatDto } from './dto/device-heartbeat.dto';

/** Mark ONLINE devices OFFLINE when lastSeen older than this (missed heartbeats). */
const DEVICE_STALE_MS = 60_000;
/** How often to scan for stale devices. */
const STALE_SWEEP_MS = 30_000;

const PICKUP_DISPLAY_TYPES: DeviceType[] = [
  DeviceType.CUSTOMER_DISPLAY,
  DeviceType.MANAGER,
];

@Injectable()
export class DevicesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DevicesService.name);
  private staleTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  onModuleInit() {
    this.staleTimer = setInterval(() => {
      void this.markStaleDevicesOffline();
    }, STALE_SWEEP_MS);
  }

  onModuleDestroy() {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
    }
  }

  async create(user: JwtPayload, dto: CreateDeviceDto) {
    const branchId = await this.authorization.resolveBranch(user, dto.branchId);

    return this.prisma.device.create({
      data: {
        branchId,
        name: dto.name,
        deviceType: dto.deviceType,
        appVersion: dto.appVersion,
        token: randomUUID(),
        tokenExpiresAt: this.tokenExpiryFromNow(),
        status: DeviceStatus.OFFLINE,
      },
    });
  }

  async findAll(user: JwtPayload, branchIdQuery?: string) {
    const branchId = await this.authorization.resolveBranch(
      user,
      branchIdQuery,
    );

    return this.prisma.device.findMany({
      where: { branchId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: JwtPayload) {
    const device = await this.getDeviceOrThrow(id);
    await this.authorization.canAccessBranch(user, device.branchId);
    return device;
  }

  async update(id: string, user: JwtPayload, dto: UpdateDeviceDto) {
    await this.findOne(id, user);

    return this.prisma.device.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, user: JwtPayload) {
    await this.findOne(id, user);

    return this.prisma.device.delete({
      where: { id },
    });
  }

  /** Rotate device pairing token (staff only). */
  async rotateToken(id: string, user: JwtPayload) {
    await this.findOne(id, user);

    return this.prisma.device.update({
      where: { id },
      data: {
        token: randomUUID(),
        tokenExpiresAt: this.tokenExpiryFromNow(),
        status: DeviceStatus.OFFLINE,
      },
    });
  }

  /** Device authenticates with its token (no user JWT). */
  async heartbeat(token: string, dto: DeviceHeartbeatDto) {
    const device = await this.findByToken(token);

    return this.prisma.device.update({
      where: { id: device.id },
      data: {
        status: DeviceStatus.ONLINE,
        lastSeen: new Date(),
        ...(dto.appVersion ? { appVersion: dto.appVersion } : {}),
      },
    });
  }

  async findByToken(token: string) {
    const device = await this.prisma.device.findUnique({
      where: { token },
      include: { branch: true },
    });

    if (!device) {
      throw new NotFoundException('Invalid device token');
    }

    this.assertTokenNotExpired(device.tokenExpiresAt);

    return device;
  }

  /**
   * Shared device gate: token present, type allowlisted, optional branch match.
   */
  async requireDeviceType(
    token: string | undefined,
    allowed: DeviceType[],
    branchId?: string,
  ) {
    if (!token) {
      throw new UnauthorizedException('x-device-token header is required');
    }

    const device = await this.findByToken(token);

    if (!allowed.includes(device.deviceType)) {
      throw new ForbiddenException(
        `Device type ${device.deviceType} is not allowed for this endpoint`,
      );
    }

    if (branchId && device.branchId !== branchId) {
      throw new ForbiddenException('Device is not paired to this branch');
    }

    await this.markOnline(device.id);
    return device;
  }

  /**
   * Pickup overhead TV: CUSTOMER_DISPLAY or MANAGER for the given branch.
   */
  async requirePickupDisplay(token: string | undefined, branchId: string) {
    return this.requireDeviceType(token, PICKUP_DISPLAY_TYPES, branchId);
  }

  async markOnline(deviceId: string) {
    return this.prisma.device.update({
      where: { id: deviceId },
      data: {
        status: DeviceStatus.ONLINE,
        lastSeen: new Date(),
      },
    });
  }

  async markOffline(deviceId: string) {
    return this.prisma.device.update({
      where: { id: deviceId },
      data: {
        status: DeviceStatus.OFFLINE,
        lastSeen: new Date(),
      },
    });
  }

  /** Flip ONLINE → OFFLINE when heartbeat / lastSeen goes quiet. */
  async markStaleDevicesOffline() {
    const cutoff = new Date(Date.now() - DEVICE_STALE_MS);

    const result = await this.prisma.device.updateMany({
      where: {
        status: DeviceStatus.ONLINE,
        OR: [{ lastSeen: { lt: cutoff } }, { lastSeen: null }],
      },
      data: {
        status: DeviceStatus.OFFLINE,
      },
    });

    if (result.count > 0) {
      this.logger.log(`Marked ${result.count} stale device(s) OFFLINE`);
    }

    return result.count;
  }

  private tokenExpiryFromNow(): Date {
    const days = Number(process.env.DEVICE_TOKEN_TTL_DAYS ?? 30);
    const ttlDays = Number.isFinite(days) && days > 0 ? days : 30;
    return new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  }

  private assertTokenNotExpired(tokenExpiresAt: Date | null) {
    if (
      tokenExpiresAt &&
      tokenExpiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException(
        'Device token has expired. Rotate the token in Admin and re-pair.',
      );
    }
  }

  private async getDeviceOrThrow(id: string) {
    const device = await this.prisma.device.findUnique({
      where: { id },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    return device;
  }
}
