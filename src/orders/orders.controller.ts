import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrderStatus, UserRole } from '@prisma/client';

import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.WAITER,
    UserRole.CASHIER,
  )
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(user, dto);
  }

  /** Kitchen queue: NEW → READY */
  @Get('kitchen')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.CHEF,
  )
  kitchen(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
  ) {
    return this.ordersService.findForKitchen(user, branchId);
  }

  /** Kitchen service snapshot: counts, wait, oldest ticket. */
  @Get('kitchen/dashboard')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.CHEF,
  )
  kitchenDashboard(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
  ) {
    return this.ordersService.getKitchenDashboard(user, branchId);
  }

  /** Waiter active orders view */
  @Get('waiter')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.WAITER,
    UserRole.CASHIER,
  )
  waiter(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
    @Query('status') status?: OrderStatus,
  ) {
    return this.ordersService.findForWaiter(user, branchId, status);
  }

  /** Cashier payments board: active + unpaid completed recovery. */
  @Get('open-bills')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.CASHIER,
  )
  openBills(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
  ) {
    return this.ordersService.findForCashier(user, branchId);
  }

  /** @deprecated Prefer open-bills — kept so old clients do not hit :id. */
  @Get('cashier')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.CASHIER,
  )
  cashier(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
  ) {
    return this.ordersService.findForCashier(user, branchId);
  }

  /** Closed checks paid in the cashier's local day (from/to ISO). */
  @Get('today-paid')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.CASHIER,
  )
  todayPaid(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.ordersService.findTodayPaidForCashier(
      user,
      branchId,
      from,
      to,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.ordersService.findOne(id, user);
  }

  @Patch(':id/status')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.CHEF,
    UserRole.WAITER,
    UserRole.CASHIER,
  )
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ordersService.updateStatus(id, dto.status, user);
  }

  /** Fire the next held course (APPETIZER → DRINK → MAIN → DESSERT → OTHER). */
  @Post(':id/fire-next')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.WAITER,
    UserRole.CHEF,
  )
  fireNext(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.ordersService.fireNext(id, user);
  }
}
