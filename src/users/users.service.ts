import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, User, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationService } from '../common/authorization/authorization.service';

import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const userListSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  restaurantId: true,
  branchId: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  restaurant: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  async createUser(currentUser: JwtPayload, dto: CreateUserDto): Promise<User> {
    this.authorization.canCreateRole(currentUser, dto.role);

    const { restaurantId, branchId } = this.authorization.resolveTenant(
      currentUser,
      dto,
    );

    if (dto.role !== UserRole.PLATFORM_ADMIN && !restaurantId) {
      throw new ForbiddenException(
        'restaurantId is required for restaurant staff.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    return this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
        restaurantId,
        branchId,
        active: true,
      },
    });
  }

  async create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({
      data,
    });
  }

  async findAll(
    currentUser: JwtPayload,
    filters?: { restaurantId?: string; branchId?: string },
  ) {
    const where: Prisma.UserWhereInput = {};

    switch (currentUser.role) {
      case UserRole.PLATFORM_ADMIN: {
        if (filters?.restaurantId) {
          where.restaurantId = filters.restaurantId;
        }
        if (filters?.branchId) {
          where.branchId = filters.branchId;
        }
        break;
      }

      case UserRole.RESTAURANT_OWNER: {
        // Prisma omits `undefined` filters — never allow an unscoped list.
        if (!currentUser.restaurantId) {
          throw new ForbiddenException(
            'User is not assigned to a restaurant.',
          );
        }
        where.restaurantId = currentUser.restaurantId;
        if (filters?.branchId) {
          const branch = await this.prisma.branch.findUnique({
            where: { id: filters.branchId },
          });
          if (!branch || branch.restaurantId !== currentUser.restaurantId) {
            throw new ForbiddenException(
              'You cannot access another restaurant.',
            );
          }
          where.branchId = filters.branchId;
        }
        break;
      }

      case UserRole.BRANCH_MANAGER: {
        if (!currentUser.branchId) {
          throw new ForbiddenException('User is not assigned to a branch.');
        }
        where.branchId = currentUser.branchId;
        break;
      }

      default:
        where.id = currentUser.sub;
        break;
    }

    return this.prisma.user.findMany({
      where,
      select: userListSelect,
      orderBy: [{ role: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async findById(currentUser: JwtPayload, id: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return null;
    }

    this.authorization.canViewUser(currentUser, user);

    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async updateUser(
    currentUser: JwtPayload,
    id: string,
    dto: UpdateUserDto,
  ) {
    const user = await this.findById(currentUser, id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    this.authorization.canEditUser(currentUser, user);

    if (dto.role) {
      this.authorization.canCreateRole(currentUser, dto.role);
    }

    const tenant = this.authorization.resolveTenant(currentUser, {
      restaurantId: dto.restaurantId ?? user.restaurantId,
      branchId: dto.branchId ?? user.branchId,
    });

    const data: Prisma.UserUncheckedUpdateInput = {
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role: dto.role,
      active: dto.active,
      restaurantId: tenant.restaurantId,
      branchId: tenant.branchId,
    };

    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 10);
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: userListSelect,
    });
  }

  /** @deprecated Prefer updateUser with UpdateUserDto */
  async update(
    currentUser: JwtPayload,
    id: string,
    data: Prisma.UserUpdateInput,
  ): Promise<User> {
    const user = await this.findById(currentUser, id);

    if (!user) {
      throw new ForbiddenException();
    }

    this.authorization.canEditUser(currentUser, user);

    return this.prisma.user.update({
      where: { id },
      data,
    });
  }

  async delete(currentUser: JwtPayload, id: string) {
    const user = await this.findById(currentUser, id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    this.authorization.canDeleteUser(currentUser, user);

    if (user.id === currentUser.sub) {
      throw new ForbiddenException('You cannot deactivate your own account.');
    }

    // Soft-deactivate so audit history and FKs stay intact.
    return this.prisma.user.update({
      where: { id },
      data: { active: false },
      select: userListSelect,
    });
  }
}
