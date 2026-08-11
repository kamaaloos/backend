import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { PaymentsService } from './payments.service';
import { CreatePaymentDto, CreatePendingCashDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { RegisterTerminalReaderDto } from './dto/register-terminal-reader.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /** Public: which ONLINE / Terminal providers are configured. */
  @Get('config')
  getConfig() {
    return this.paymentsService.getProviderConfig();
  }

  /** Stripe Terminal connection token for the cashier SDK. */
  @Post('terminal/connection-token')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.CASHIER,
  )
  terminalConnectionToken() {
    return this.paymentsService.createTerminalConnectionToken();
  }

  /** Physical readers registered at STRIPE_TERMINAL_LOCATION_ID. */
  @Get('terminal/readers')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.CASHIER,
  )
  listTerminalReaders() {
    return this.paymentsService.listTerminalReaders();
  }

  /** Register a WisePOS / BBPOS reader with its on-screen pairing code. */
  @Post('terminal/readers/register')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.CASHIER,
  )
  registerTerminalReader(@Body() dto: RegisterTerminalReaderDto) {
    return this.paymentsService.registerTerminalReader(dto);
  }

  @Post()
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.WAITER,
    UserRole.CASHIER,
  )
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreatePaymentDto) {
    return this.paymentsService.create(user, dto);
  }

  /** Record unpaid CASH on the till; settle later with PATCH …/paid. */
  @Post('pending-cash')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.CASHIER,
  )
  createPendingCash(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePendingCashDto,
  ) {
    return this.paymentsService.createPendingCash(user, dto);
  }

  @Get('order/:orderId')
  findByOrder(
    @Param('orderId') orderId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentsService.findByOrder(orderId, user);
  }

  @Patch(':id/paid')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.CASHIER,
  )
  markPaid(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.paymentsService.markPaid(id, user);
  }

  /**
   * Optional Stripe reconcile for Terminal (local/dev without webhooks).
   * Production authority: payment_intent.succeeded webhook → PAID.
   */
  @Post(':id/confirm-terminal')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.CASHIER,
  )
  confirmTerminal(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.paymentsService.confirmTerminalPayment(id, user);
  }

  @Post(':id/refund')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.CASHIER,
  )
  refund(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: RefundPaymentDto,
  ) {
    return this.paymentsService.refund(id, user, dto);
  }
}
