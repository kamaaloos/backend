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

import { MenuService } from './menu.service';
import { CreateMenuCategoryDto } from './dto/create-menu-category.dto';
import { UpdateMenuCategoryDto } from './dto/update-menu-category.dto';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { CreateModifierGroupDto } from './dto/create-modifier-group.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('menu')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  @Post('categories')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
  )
  createCategory(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateMenuCategoryDto,
  ) {
    return this.menuService.createCategory(user, dto);
  }

  @Get('categories')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.WAITER,
    UserRole.CHEF,
    UserRole.CASHIER,
  )
  findCategories(
    @CurrentUser() user: JwtPayload,
    @Query('restaurantId') restaurantId?: string,
  ) {
    return this.menuService.findCategories(user, restaurantId);
  }

  @Get('categories/:id')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.WAITER,
    UserRole.CHEF,
    UserRole.CASHIER,
  )
  findCategory(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.menuService.findCategory(id, user);
  }

  @Patch('categories/:id')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
  )
  updateCategory(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateMenuCategoryDto,
  ) {
    return this.menuService.updateCategory(id, user, dto);
  }

  @Delete('categories/:id')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
  )
  removeCategory(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.menuService.removeCategory(id, user);
  }

  @Post('items')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
  )
  createItem(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateMenuItemDto,
  ) {
    return this.menuService.createItem(user, dto);
  }

  @Get('items')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.WAITER,
    UserRole.CHEF,
    UserRole.CASHIER,
  )
  findItems(
    @CurrentUser() user: JwtPayload,
    @Query('restaurantId') restaurantId?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.menuService.findItems(user, restaurantId, categoryId);
  }

  @Get('items/:id')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.WAITER,
    UserRole.CHEF,
    UserRole.CASHIER,
  )
  findItem(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.menuService.findItem(id, user);
  }

  @Patch('items/:id')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
  )
  updateItem(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateMenuItemDto,
  ) {
    return this.menuService.updateItem(id, user, dto);
  }

  @Delete('items/:id')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
  )
  removeItem(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.menuService.removeItem(id, user);
  }

  @Post('modifiers/groups')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
  )
  createModifierGroup(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateModifierGroupDto,
  ) {
    return this.menuService.createModifierGroup(user, dto);
  }

  @Get('items/:id/modifiers')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
    UserRole.WAITER,
    UserRole.CHEF,
    UserRole.CASHIER,
  )
  listModifiers(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.menuService.listModifierGroups(id, user);
  }

  @Delete('modifiers/groups/:id')
  @Roles(
    UserRole.PLATFORM_ADMIN,
    UserRole.RESTAURANT_OWNER,
    UserRole.BRANCH_MANAGER,
  )
  removeModifierGroup(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.menuService.removeModifierGroup(id, user);
  }
}
