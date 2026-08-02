/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
import { ForbiddenException, Injectable } from '@nestjs/common';
import { User, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ROLE_PERMISSIONS } from './role-permissions';

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}
  canCreateRole(currentUser: JwtPayload, role: UserRole) {
    const allowed = ROLE_PERMISSIONS[currentUser.role] ?? [];

    if (!allowed.includes(role)) {
      throw new ForbiddenException(
        `Role ${currentUser.role} cannot create ${role}`,
      );
    }
  }

  resolveTenant(
    currentUser: JwtPayload,
    dto: {
      restaurantId?: string | null;
      branchId?: string | null;
    },
  ) {
    switch (currentUser.role) {
      case UserRole.PLATFORM_ADMIN:
        return {
          restaurantId: dto.restaurantId ?? null,
          branchId: dto.branchId ?? null,
        };

      case UserRole.RESTAURANT_OWNER:
        return {
          restaurantId: currentUser.restaurantId,
          branchId: dto.branchId ?? null,
        };

      case UserRole.BRANCH_MANAGER:
        return {
          restaurantId: currentUser.restaurantId,
          branchId: currentUser.branchId,
        };

      default:
        throw new ForbiddenException();
    }
  }

  async resolveBranch(
    currentUser: JwtPayload,
    requestedBranchId?: string,
  ): Promise<string> {
    switch (currentUser.role) {
      case UserRole.PLATFORM_ADMIN: {
        if (!requestedBranchId) {
          throw new ForbiddenException('Branch ID is required.');
        }

        return requestedBranchId;
      }

      case UserRole.RESTAURANT_OWNER: {
        if (!requestedBranchId) {
          throw new ForbiddenException('Branch ID is required.');
        }

        const branch = await this.prisma.branch.findUnique({
          where: {
            id: requestedBranchId,
          },
        });

        if (!branch) {
          throw new ForbiddenException('Branch not found.');
        }

        if (branch.restaurantId !== currentUser.restaurantId) {
          throw new ForbiddenException('You cannot access another restaurant.');
        }

        return branch.id;
      }

      case UserRole.BRANCH_MANAGER:
      case UserRole.WAITER:
      case UserRole.CHEF:
      case UserRole.CASHIER: {
        if (!currentUser.branchId) {
          throw new ForbiddenException(
            'User is not assigned to a branch.',
          );
        }

        return currentUser.branchId;
      }

      default:
        throw new ForbiddenException('Access denied.');
    }
  }

  canViewUser(currentUser: JwtPayload, user: User) {
    switch (currentUser.role) {
      case UserRole.PLATFORM_ADMIN:
        return;

      case UserRole.RESTAURANT_OWNER:
        if (user.restaurantId === currentUser.restaurantId) return;
        break;

      case UserRole.BRANCH_MANAGER:
        if (user.branchId === currentUser.branchId) return;
        break;

      default:
        if (user.id === currentUser.sub) return;
    }

    throw new ForbiddenException();
  }

  canEditUser(currentUser: JwtPayload, user: User) {
    this.canViewUser(currentUser, user);
  }

  canDeleteUser(currentUser: JwtPayload, user: User) {
    this.canViewUser(currentUser, user);
  }

  async canAccessBranch(
    currentUser: JwtPayload,
    branchId: string,
  ): Promise<void> {
    switch (currentUser.role) {
      case UserRole.PLATFORM_ADMIN:
        return;

      case UserRole.RESTAURANT_OWNER: {
        const branch = await this.prisma.branch.findUnique({
          where: { id: branchId },
        });

        if (!branch) {
          throw new ForbiddenException('Branch not found.');
        }

        if (branch.restaurantId !== currentUser.restaurantId) {
          throw new ForbiddenException('You cannot access another restaurant.');
        }

        return;
      }

      case UserRole.BRANCH_MANAGER:
      case UserRole.WAITER:
      case UserRole.CHEF:
      case UserRole.CASHIER:
        if (currentUser.branchId === branchId) {
          return;
        }
        break;
    }

    throw new ForbiddenException();
  }

  /** Resolve which restaurant the caller may access (admin may pass restaurantId). */
  resolveRestaurantId(
    currentUser: JwtPayload,
    requestedRestaurantId?: string,
  ): string {
    switch (currentUser.role) {
      case UserRole.PLATFORM_ADMIN: {
        if (!requestedRestaurantId) {
          throw new ForbiddenException('Restaurant ID is required.');
        }
        return requestedRestaurantId;
      }

      case UserRole.RESTAURANT_OWNER:
      case UserRole.BRANCH_MANAGER:
      case UserRole.WAITER:
      case UserRole.CHEF:
      case UserRole.CASHIER: {
        if (!currentUser.restaurantId) {
          throw new ForbiddenException(
            'User is not assigned to a restaurant.',
          );
        }

        if (
          requestedRestaurantId &&
          requestedRestaurantId !== currentUser.restaurantId
        ) {
          throw new ForbiddenException('You cannot access another restaurant.');
        }

        return currentUser.restaurantId;
      }

      default:
        throw new ForbiddenException('Access denied.');
    }
  }

  async canAccessRestaurant(
    currentUser: JwtPayload,
    restaurantId: string,
  ): Promise<void> {
    switch (currentUser.role) {
      case UserRole.PLATFORM_ADMIN:
        return;

      case UserRole.RESTAURANT_OWNER:
      case UserRole.BRANCH_MANAGER:
      case UserRole.WAITER:
      case UserRole.CHEF:
      case UserRole.CASHIER:
        if (currentUser.restaurantId === restaurantId) {
          return;
        }
        break;
    }

    throw new ForbiddenException('You cannot access another restaurant.');
  }
}
