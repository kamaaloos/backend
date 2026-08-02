import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TableStatus } from '@prisma/client';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

import { TablesService } from './tables.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';

@Controller('tables')
@UseGuards(JwtAuthGuard)
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Post()
  create(@Body() dto: CreateTableDto, @CurrentUser() user: JwtPayload) {
    return this.tablesService.create(dto, user);
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
    @Query('status') status?: TableStatus,
  ) {
    return this.tablesService.findAll(user, { branchId, status });
  }

  @Get('deleted')
  findDeleted(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
  ) {
    return this.tablesService.findDeleted(user, { branchId });
  }

  @Post(':id/occupy')
  occupy(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.tablesService.occupy(id, user);
  }

  @Post(':id/release')
  release(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.tablesService.release(id, user);
  }

  @Post(':id/reserve')
  reserve(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.tablesService.reserve(id, user);
  }

  @Post(':id/unreserve')
  unreserve(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.tablesService.unreserve(id, user);
  }

  @Get('available')
  available(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
  ) {
    return this.tablesService.available(user, { branchId });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.tablesService.findOne(id, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTableDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.tablesService.update(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.tablesService.remove(id, user);
  }

  @Post(':id/rotate-qr')
  rotateQr(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.tablesService.rotateQrToken(id, user);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.tablesService.restore(id, user);
  }
}
