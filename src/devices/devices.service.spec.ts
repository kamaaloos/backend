import { UnauthorizedException } from '@nestjs/common';
import { DeviceStatus, DeviceType } from '@prisma/client';

import { DevicesService } from './devices.service';

describe('DevicesService hardening', () => {
  const prisma = {
    device: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const authorization = {
    resolveBranch: jest.fn().mockResolvedValue('branch-1'),
    canAccessBranch: jest.fn().mockResolvedValue(undefined),
  };

  const user = {
    sub: 'user-1',
    email: 'admin@test.local',
    role: 'PLATFORM_ADMIN',
  } as never;

  let service: DevicesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DevicesService(prisma as never, authorization as never);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  function baseDevice(overrides: Record<string, unknown> = {}) {
    return {
      id: 'dev-1',
      branchId: 'branch-1',
      name: 'Kitchen TV',
      deviceType: DeviceType.KITCHEN,
      status: DeviceStatus.OFFLINE,
      token: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      tokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      pairingCode: 'AB12CD34',
      pairingCodeExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      lastSeen: null,
      appVersion: null,
      createdAt: new Date(),
      ...overrides,
    };
  }

  it('create returns token once and redacts it from staff list shape', async () => {
    const created = baseDevice();
    prisma.device.create.mockResolvedValue(created);

    const result = await service.create(user, {
      name: 'Kitchen TV',
      deviceType: DeviceType.KITCHEN,
      branchId: 'branch-1',
    });

    expect(result.token).toBe(created.token);
    expect(result.tokenPreview).toBe(created.token.slice(0, 8));
    expect(result.pairingCode).toHaveLength(8);
    expect(prisma.device.create).toHaveBeenCalled();
  });

  it('findAll never includes the bearer token', async () => {
    prisma.device.findMany.mockResolvedValue([baseDevice()]);

    const [row] = await service.findAll(user, 'branch-1');

    expect(row.token).toBeUndefined();
    expect(row.tokenPreview).toBe('aaaaaaaa');
    expect(row.pairingCode).toBe('AB12CD34');
  });

  it('exchangePairingCode returns token and clears the code', async () => {
    const device = baseDevice();
    prisma.device.findUnique.mockResolvedValue(device);
    prisma.device.update.mockResolvedValue({
      ...device,
      pairingCode: null,
      pairingCodeExpiresAt: null,
      status: DeviceStatus.ONLINE,
    });

    const result = await service.exchangePairingCode('ab12cd34');

    expect(result.token).toBe(device.token);
    expect(prisma.device.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: device.id },
        data: expect.objectContaining({
          pairingCode: null,
          pairingCodeExpiresAt: null,
        }),
      }),
    );
  });

  it('rejects expired pairing codes', async () => {
    prisma.device.findUnique.mockResolvedValue(
      baseDevice({
        pairingCodeExpiresAt: new Date(Date.now() - 1000),
      }),
    );
    prisma.device.update.mockResolvedValue(baseDevice());

    await expect(service.exchangePairingCode('AB12CD34')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('revoke expires the token and clears pairing code', async () => {
    prisma.device.findUnique.mockResolvedValue(baseDevice());
    prisma.device.update.mockResolvedValue(
      baseDevice({
        tokenExpiresAt: new Date(),
        pairingCode: null,
        pairingCodeExpiresAt: null,
      }),
    );

    const result = await service.revoke('dev-1', user);

    expect(result.token).toBeUndefined();
    expect(prisma.device.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pairingCode: null,
          pairingCodeExpiresAt: null,
          status: DeviceStatus.OFFLINE,
        }),
      }),
    );
  });
});
