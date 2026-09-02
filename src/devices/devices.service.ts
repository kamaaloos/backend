import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { Device, DeviceStatus, DeviceType } from '@prisma/client';
import { randomBytes, randomUUID } from 'crypto';

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

/** Default device token lifetime (override with DEVICE_TOKEN_TTL_DAYS). */
const DEFAULT_TOKEN_TTL_DAYS = 7;
/** One-time pairing code lifetime (override with DEVICE_PAIRING_CODE_TTL_MINUTES). */
const DEFAULT_PAIRING_CODE_TTL_MINUTES = 10;

/** Ambiguity-safe alphabet for short pairing codes. */
const PAIRING_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const PAIRING_CODE_LENGTH = 8;

const PICKUP_DISPLAY_TYPES: DeviceType[] = [
  DeviceType.CUSTOMER_DISPLAY,
  DeviceType.MANAGER,
];

type DeviceRecord = Device & { branch?: unknown };

export type StaffDeviceView = Omit<Device, 'token'> & {
  /** Present only on create / rotate responses. */
  token?: string;
  tokenPreview: string;
};

@Injectable()
export class DevicesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DevicesService.name);
  private staleTimer?: ReturnType<typeof setInterval>;
  /** Prevent overlapping sweeps when the DB is slow. */
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  onModuleInit() {
    this.staleTimer = setInterval(() => {
      void this.markStaleDevicesOffline().catch((err) => {
        this.logger.warn(
          `Stale device sweep failed: ${(err as Error).message}`,
        );
      });
    }, STALE_SWEEP_MS);
  }

  onModuleDestroy() {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
    }
  }

  async create(user: JwtPayload, dto: CreateDeviceDto) {
    const branchId = await this.authorization.resolveBranch(user, dto.branchId);
    const token = randomUUID();
    const pairing = this.newPairingCode();

    const device = await this.prisma.device.create({
      data: {
        branchId,
        name: dto.name,
        deviceType: dto.deviceType,
        appVersion: dto.appVersion,
        token,
        tokenExpiresAt: this.tokenExpiryFromNow(),
        pairingCode: pairing.code,
        pairingCodeExpiresAt: pairing.expiresAt,
        status: DeviceStatus.OFFLINE,
      },
    });

    return this.toStaffView(device, { includeToken: true });
  }

  async findAll(user: JwtPayload, branchIdQuery?: string) {
    const branchId = await this.authorization.resolveBranch(
      user,
      branchIdQuery,
    );

    const devices = await this.prisma.device.findMany({
      where: { branchId },
      orderBy: { createdAt: 'desc' },
    });

    return devices.map((d) => this.toStaffView(d));
  }

  async findOne(id: string, user: JwtPayload) {
    const device = await this.getDeviceOrThrow(id);
    await this.authorization.canAccessBranch(user, device.branchId);
    return this.toStaffView(device);
  }

  async update(id: string, user: JwtPayload, dto: UpdateDeviceDto) {
    await this.findOne(id, user);

    const device = await this.prisma.device.update({
      where: { id },
      data: dto,
    });

    return this.toStaffView(device);
  }

  async remove(id: string, user: JwtPayload) {
    await this.findOne(id, user);

    return this.prisma.device.delete({
      where: { id },
    });
  }

  /** Rotate device bearer token (staff only). Issues a fresh pairing code. */
  async rotateToken(id: string, user: JwtPayload) {
    await this.findOne(id, user);
    const pairing = this.newPairingCode();

    const device = await this.prisma.device.update({
      where: { id },
      data: {
        token: randomUUID(),
        tokenExpiresAt: this.tokenExpiryFromNow(),
        pairingCode: pairing.code,
        pairingCodeExpiresAt: pairing.expiresAt,
        status: DeviceStatus.OFFLINE,
      },
    });

    return this.toStaffView(device, { includeToken: true });
  }

  /**
   * Issue / refresh a short-lived one-time pairing code for QR URLs.
   * Does not rotate the long-lived bearer token.
   */
  async issuePairingCode(id: string, user: JwtPayload) {
    await this.findOne(id, user);
    const pairing = this.newPairingCode();

    const device = await this.prisma.device.update({
      where: { id },
      data: {
        pairingCode: pairing.code,
        pairingCodeExpiresAt: pairing.expiresAt,
      },
    });

    return this.toStaffView(device);
  }

  /**
   * Invalidate the current bearer token immediately and clear pairing codes.
   * The device must be rotated (or deleted) before it can pair again.
   */
  async revoke(id: string, user: JwtPayload) {
    await this.findOne(id, user);

    const device = await this.prisma.device.update({
      where: { id },
      data: {
        token: randomUUID(),
        tokenExpiresAt: new Date(),
        pairingCode: null,
        pairingCodeExpiresAt: null,
        status: DeviceStatus.OFFLINE,
      },
    });

    return this.toStaffView(device);
  }

  /**
   * Public: exchange a one-time pairing code for the long-lived device token.
   * Code is cleared on success so QR URLs cannot be replayed.
   */
  async exchangePairingCode(rawCode: string) {
    const code = rawCode.trim().toUpperCase();
    if (!code) {
      throw new BadRequestException('Pairing code is required');
    }

    const device = await this.prisma.device.findUnique({
      where: { pairingCode: code },
    });

    if (!device || !device.pairingCodeExpiresAt) {
      throw new UnauthorizedException('Invalid or expired pairing code');
    }

    if (device.pairingCodeExpiresAt.getTime() <= Date.now()) {
      await this.prisma.device.update({
        where: { id: device.id },
        data: { pairingCode: null, pairingCodeExpiresAt: null },
      });
      throw new UnauthorizedException('Invalid or expired pairing code');
    }

    this.assertTokenNotExpired(device.tokenExpiresAt);

    const cleared = await this.prisma.device.update({
      where: { id: device.id },
      data: {
        pairingCode: null,
        pairingCodeExpiresAt: null,
        status: DeviceStatus.ONLINE,
        lastSeen: new Date(),
      },
    });

    return {
      token: cleared.token,
      device: {
        id: cleared.id,
        name: cleared.name,
        deviceType: cleared.deviceType,
        branchId: cleared.branchId,
        tokenExpiresAt: cleared.tokenExpiresAt,
      },
    };
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
    if (this.sweeping) return 0;
    this.sweeping = true;
    try {
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
    } catch (err) {
      this.logger.warn(
        `Stale device sweep failed: ${(err as Error).message}`,
      );
      return 0;
    } finally {
      this.sweeping = false;
    }
  }

  /** Staff JSON: never leak bearer token unless explicitly requested once. */
  toStaffView(
    device: DeviceRecord,
    options: { includeToken?: boolean } = {},
  ): StaffDeviceView {
    const { token, ...rest } = device;
    const activePairing =
      rest.pairingCode &&
      rest.pairingCodeExpiresAt &&
      rest.pairingCodeExpiresAt.getTime() > Date.now()
        ? {
            pairingCode: rest.pairingCode,
            pairingCodeExpiresAt: rest.pairingCodeExpiresAt,
          }
        : { pairingCode: null, pairingCodeExpiresAt: null };

    return {
      ...rest,
      ...activePairing,
      tokenPreview: token.slice(0, 8),
      ...(options.includeToken ? { token } : {}),
    };
  }

  private newPairingCode() {
    const bytes = randomBytes(PAIRING_CODE_LENGTH);
    let code = '';
    for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
      code += PAIRING_CODE_ALPHABET[bytes[i]! % PAIRING_CODE_ALPHABET.length];
    }
    return {
      code,
      expiresAt: this.pairingCodeExpiryFromNow(),
    };
  }

  private tokenExpiryFromNow(): Date {
    const days = Number(
      process.env.DEVICE_TOKEN_TTL_DAYS ?? DEFAULT_TOKEN_TTL_DAYS,
    );
    const ttlDays =
      Number.isFinite(days) && days > 0 ? days : DEFAULT_TOKEN_TTL_DAYS;
    return new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  }

  private pairingCodeExpiryFromNow(): Date {
    const minutes = Number(
      process.env.DEVICE_PAIRING_CODE_TTL_MINUTES ??
        DEFAULT_PAIRING_CODE_TTL_MINUTES,
    );
    const ttl =
      Number.isFinite(minutes) && minutes > 0
        ? minutes
        : DEFAULT_PAIRING_CODE_TTL_MINUTES;
    return new Date(Date.now() + ttl * 60 * 1000);
  }

  private assertTokenNotExpired(tokenExpiresAt: Date | null) {
    if (tokenExpiresAt && tokenExpiresAt.getTime() <= Date.now()) {
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
