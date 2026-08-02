import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { SkipThrottle, Throttle } from '@nestjs/throttler';

import { CustomerService } from './customer.service';
import { PlaceCustomerOrderDto } from './dto/place-customer-order.dto';
import { PayWalkInOrderDto } from './dto/pay-walk-in-order.dto';
import { CreateServiceRequestDto } from './dto/create-service-request.dto';
import { PaymentsService } from '../payments/payments.service';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AuthorizationService } from '../common/authorization/authorization.service';

@Controller()
export class CustomerController {
  constructor(
    private readonly customerService: CustomerService,
    private readonly paymentsService: PaymentsService,
    private readonly authorization: AuthorizationService,
  ) {}

  // --- Walk-in (standing / queue) — declare before :token routes ---

  @Get('customer/walk-in/branches')
  listWalkInBranches() {
    return this.customerService.listWalkInBranches();
  }

  /** Public: ONLINE provider flag for guest pay UI. */
  @Get('customer/payments/config')
  getPaymentConfig() {
    return this.paymentsService.getProviderConfig();
  }

  @Get('customer/walk-in/:walkInToken/menu')
  getWalkInMenu(@Param('walkInToken') walkInToken: string) {
    return this.customerService.getWalkInMenu(walkInToken);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('customer/walk-in/:walkInToken/orders')
  placeWalkInOrder(
    @Param('walkInToken') walkInToken: string,
    @Body() dto: PlaceCustomerOrderDto,
  ) {
    return this.customerService.placeWalkInOrder(walkInToken, dto);
  }

  @Get('customer/walk-in/:walkInToken/orders/:orderId')
  getWalkInOrder(
    @Param('walkInToken') walkInToken: string,
    @Param('orderId') orderId: string,
  ) {
    return this.customerService.getWalkInOrder(walkInToken, orderId);
  }

  /** Walk-in prepay — kitchen receives the ticket only after PAID. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('customer/walk-in/:walkInToken/orders/:orderId/pay')
  async payWalkInOrder(
    @Param('walkInToken') walkInToken: string,
    @Param('orderId') orderId: string,
    @Body() dto: PayWalkInOrderDto,
  ) {
    const branch =
      await this.customerService.resolveWalkInBranch(walkInToken);
    return this.paymentsService.payWalkInOrder(
      branch.id,
      orderId,
      dto.method,
      walkInToken,
    );
  }

  /** Overhead TV: Preparing | Ready — requires CUSTOMER_DISPLAY device token. */
  @Get('customer/walk-in/:walkInToken/pickup-board')
  getPickupBoard(
    @Param('walkInToken') walkInToken: string,
    @Headers('x-device-token') deviceToken: string | undefined,
  ) {
    return this.customerService.getPickupBoard(walkInToken, deviceToken);
  }

  // --- Table QR (dine-in) ---

  /** Public: browse menu (categories + modifiers). */
  @Get('customer/:token/menu')
  getMenu(@Param('token') token: string) {
    return this.customerService.getMenu(token);
  }

  @Get('customer/:token/menu/items/:itemId')
  getMenuItem(
    @Param('token') token: string,
    @Param('itemId') itemId: string,
  ) {
    return this.customerService.getMenuItem(token, itemId);
  }

  /** Public: place cart as an order. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('customer/:token/orders')
  placeOrder(
    @Param('token') token: string,
    @Body() dto: PlaceCustomerOrderDto,
  ) {
    return this.customerService.placeOrder(token, dto);
  }

  /** Public: live order list for this table. */
  @Get('customer/:token/orders')
  listOrders(@Param('token') token: string) {
    return this.customerService.listOrders(token);
  }

  /** Public: track a single order. */
  @Get('customer/:token/orders/:orderId')
  getOrder(
    @Param('token') token: string,
    @Param('orderId') orderId: string,
  ) {
    return this.customerService.getOrder(token, orderId);
  }

  /** Public: call waiter / request bill. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('customer/:token/service-requests')
  createServiceRequest(
    @Param('token') token: string,
    @Body() dto: CreateServiceRequestDto,
  ) {
    return this.customerService.createServiceRequest(token, dto);
  }

  /** Staff: open service requests for branch. */
  @SkipThrottle()
  @Get('service-requests')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.WAITER,
    UserRole.CASHIER,
  )
  async listServiceRequests(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
  ) {
    const resolved = await this.authorization.resolveBranch(user, branchId);
    return this.customerService.listServiceRequestsForStaff(resolved);
  }

  @SkipThrottle()
  @Patch('service-requests/:id/acknowledge')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.WAITER,
    UserRole.CASHIER,
  )
  async acknowledge(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
  ) {
    const resolved = await this.authorization.resolveBranch(user, branchId);
    return this.customerService.acknowledgeServiceRequest(id, resolved);
  }

  @SkipThrottle()
  @Patch('service-requests/:id/complete')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.WAITER,
    UserRole.CASHIER,
  )
  async complete(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
  ) {
    const resolved = await this.authorization.resolveBranch(user, branchId);
    return this.customerService.completeServiceRequest(id, resolved);
  }
}
