import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { UserRole } from '@prisma/client';

import { RestaurantsService } from './restaurants.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('restaurants')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RestaurantsController {
  constructor(private readonly restaurantsService: RestaurantsService) {}

  @Post()
  @Roles(UserRole.PLATFORM_ADMIN)
  create(@Body() dto: CreateRestaurantDto) {
    return this.restaurantsService.create(dto);
  }

  @Get()
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.WAITER,
    UserRole.CHEF,
    UserRole.CASHIER,
  )
  findAll(@CurrentUser() user: JwtPayload) {
    return this.restaurantsService.findAll(user);
  }

  @Get(':id')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.WAITER,
    UserRole.CHEF,
    UserRole.CASHIER,
  )
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.restaurantsService.findOne(id, user);
  }

  @Patch(':id')
  @Roles(UserRole.PLATFORM_ADMIN, UserRole.RESTAURANT_OWNER)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRestaurantDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.restaurantsService.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(UserRole.PLATFORM_ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.restaurantsService.remove(id, user);
  }
}
