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
import { UserRole } from '@prisma/client';

import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
  )
  create(@CurrentUser() currentUser: JwtPayload, @Body() dto: CreateUserDto) {
    return this.usersService.createUser(currentUser, dto);
  }

  @Get()
  findAll(
    @CurrentUser() currentUser: JwtPayload,
    @Query('restaurantId') restaurantId?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.usersService.findAll(currentUser, {
      restaurantId,
      branchId,
    });
  }

  @Get(':id')
  findOne(@CurrentUser() currentUser: JwtPayload, @Param('id') id: string) {
    return this.usersService.findById(currentUser, id);
  }

  @Patch(':id')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
  )
  update(
    @CurrentUser() currentUser: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateUser(currentUser, id, dto);
  }

  @Delete(':id')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
  )
  remove(@CurrentUser() currentUser: JwtPayload, @Param('id') id: string) {
    return this.usersService.delete(currentUser, id);
  }
}
