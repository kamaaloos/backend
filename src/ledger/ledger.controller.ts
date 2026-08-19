import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { LedgerService } from './ledger.service';

@Controller('ledger')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  UserRole.ACCOUNTANT,
  UserRole.RESTAURANT_OWNER,
  UserRole.PLATFORM_ADMIN,
)
export class LedgerController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('restaurantId') restaurantId?: string,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const resolvedRestaurantId = this.authorization.resolveRestaurantId(
      user,
      restaurantId,
    );
    return this.ledger.findEntries({
      restaurantId: resolvedRestaurantId,
      branchId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
    });
  }

  @Get('summary')
  async summary(
    @CurrentUser() user: JwtPayload,
    @Query('restaurantId') restaurantId?: string,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const resolvedRestaurantId = this.authorization.resolveRestaurantId(
      user,
      restaurantId,
    );
    return this.ledger.summary({
      restaurantId: resolvedRestaurantId,
      branchId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }
}
