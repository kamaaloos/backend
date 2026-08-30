import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { UsersService } from './users.service';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

describe('UsersService.findAll scoping', () => {
  const findMany = jest.fn().mockResolvedValue([]);
  const branchFindUnique = jest.fn();

  const prisma = {
    user: { findMany },
    branch: { findUnique: branchFindUnique },
  } as unknown as PrismaService;

  const authorization = {} as AuthorizationService;
  const service = new UsersService(prisma, authorization);

  beforeEach(() => {
    findMany.mockClear();
    branchFindUnique.mockClear();
  });

  function user(
    partial: Partial<JwtPayload> & Pick<JwtPayload, 'role'>,
  ): JwtPayload {
    return {
      sub: 'u1',
      id: 'u1',
      email: 'u@x',
      restaurantId: null,
      branchId: null,
      ...partial,
    };
  }

  it('scopes restaurant owners to their restaurantId', async () => {
    await service.findAll(
      user({
        role: UserRole.RESTAURANT_OWNER,
        restaurantId: 'rest-a',
      }),
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { restaurantId: 'rest-a' },
      }),
    );
  });

  it('rejects restaurant owners without restaurantId (no unscoped list)', async () => {
    await expect(
      service.findAll(
        user({
          role: UserRole.RESTAURANT_OWNER,
          restaurantId: null,
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(findMany).not.toHaveBeenCalled();
  });

  it('ignores client restaurantId for owners and keeps JWT restaurant', async () => {
    await service.findAll(
      user({
        role: UserRole.RESTAURANT_OWNER,
        restaurantId: 'rest-a',
      }),
      { restaurantId: 'rest-other' },
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { restaurantId: 'rest-a' },
      }),
    );
  });

  it('allows branch filter only inside the owner restaurant', async () => {
    branchFindUnique.mockResolvedValue({
      id: 'br-1',
      restaurantId: 'rest-a',
    });

    await service.findAll(
      user({
        role: UserRole.RESTAURANT_OWNER,
        restaurantId: 'rest-a',
      }),
      { branchId: 'br-1' },
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { restaurantId: 'rest-a', branchId: 'br-1' },
      }),
    );
  });

  it('rejects branch filter from another restaurant', async () => {
    branchFindUnique.mockResolvedValue({
      id: 'br-x',
      restaurantId: 'rest-other',
    });

    await expect(
      service.findAll(
        user({
          role: UserRole.RESTAURANT_OWNER,
          restaurantId: 'rest-a',
        }),
        { branchId: 'br-x' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(findMany).not.toHaveBeenCalled();
  });

  it('scopes branch managers to their branchId', async () => {
    await service.findAll(
      user({
        role: UserRole.BRANCH_MANAGER,
        restaurantId: 'rest-a',
        branchId: 'br-1',
      }),
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { branchId: 'br-1' },
      }),
    );
  });

  it('rejects branch managers without branchId', async () => {
    await expect(
      service.findAll(
        user({
          role: UserRole.BRANCH_MANAGER,
          restaurantId: 'rest-a',
          branchId: null,
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
