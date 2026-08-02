import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UserRole } from '@prisma/client';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { AuthorizationService } from '../common/authorization/authorization.service';

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  async create(dto: CreateBranchDto) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: {
        id: dto.restaurantId,
      },
    });

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    return this.prisma.branch.create({
      data: {
        ...dto,
        walkInToken: randomUUID(),
      },
    });
  }

  /** Rotate opaque walk-in ordering token (invalidates old /w/ links). */
  async rotateWalkInToken(id: string, user: JwtPayload) {
    await this.findOne(id, user);

    return this.prisma.branch.update({
      where: { id },
      data: { walkInToken: randomUUID() },
    });
  }

  async findAll(user: JwtPayload) {
    if (user.role === UserRole.PLATFORM_ADMIN) {
      return this.prisma.branch.findMany();
    }

    if (
      user.role === UserRole.BRANCH_MANAGER ||
      user.role === UserRole.WAITER ||
      user.role === UserRole.CHEF ||
      user.role === UserRole.CASHIER
    ) {
      if (!user.branchId) {
        return [];
      }

      return this.prisma.branch.findMany({
        where: { id: user.branchId },
      });
    }

    return this.prisma.branch.findMany({
      where: {
        restaurantId: user.restaurantId!,
      },
    });
  }

  async findOne(id: string, user: JwtPayload) {
    await this.authorization.canAccessBranch(user, id);

    const branch = await this.prisma.branch.findUnique({
      where: { id },
      include: {
        restaurant: true,
      },
    });

    if (!branch) {
      throw new NotFoundException('Branch not found');
    }

    return branch;
  }

  async update(id: string, dto: UpdateBranchDto, user: JwtPayload) {
    await this.findOne(id, user);

    return this.prisma.branch.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, user: JwtPayload) {
    await this.findOne(id, user);

    return this.prisma.branch.delete({
      where: { id },
    });
  }
}
