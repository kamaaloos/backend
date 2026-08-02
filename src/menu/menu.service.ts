import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateMenuCategoryDto } from './dto/create-menu-category.dto';
import { UpdateMenuCategoryDto } from './dto/update-menu-category.dto';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { CreateModifierGroupDto } from './dto/create-modifier-group.dto';

@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  async createCategory(user: JwtPayload, dto: CreateMenuCategoryDto) {
    const restaurantId = this.authorization.resolveRestaurantId(
      user,
      dto.restaurantId,
    );

    return this.prisma.menuCategory.create({
      data: {
        restaurantId,
        name: dto.name,
        displayOrder: dto.displayOrder ?? 0,
        active: dto.active ?? true,
      },
    });
  }

  async findCategories(user: JwtPayload, restaurantIdQuery?: string) {
    const restaurantId = this.authorization.resolveRestaurantId(
      user,
      restaurantIdQuery,
    );

    return this.prisma.menuCategory.findMany({
      where: { restaurantId },
      include: {
        menuItems: {
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async findCategory(id: string, user: JwtPayload) {
    const category = await this.prisma.menuCategory.findUnique({
      where: { id },
      include: { menuItems: true },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    await this.authorization.canAccessRestaurant(user, category.restaurantId);
    return category;
  }

  async updateCategory(
    id: string,
    user: JwtPayload,
    dto: UpdateMenuCategoryDto,
  ) {
    await this.findCategory(id, user);

    return this.prisma.menuCategory.update({
      where: { id },
      data: dto,
    });
  }

  async removeCategory(id: string, user: JwtPayload) {
    const category = await this.findCategory(id, user);

    const itemCount = await this.prisma.menuItem.count({
      where: { categoryId: id },
    });

    if (itemCount > 0) {
      throw new BadRequestException(
        'Category still has menu items. Move or delete them first.',
      );
    }

    return this.prisma.menuCategory.delete({
      where: { id: category.id },
    });
  }

  async createItem(user: JwtPayload, dto: CreateMenuItemDto) {
    const restaurantId = this.authorization.resolveRestaurantId(
      user,
      dto.restaurantId,
    );

    const category = await this.prisma.menuCategory.findUnique({
      where: { id: dto.categoryId },
    });

    if (!category || category.restaurantId !== restaurantId) {
      throw new BadRequestException(
        'Category not found for this restaurant',
      );
    }

    return this.prisma.menuItem.create({
      data: {
        restaurantId,
        categoryId: dto.categoryId,
        name: dto.name,
        description: dto.description,
        price: dto.price,
        imageUrl: dto.imageUrl,
        active: dto.active ?? true,
      },
    });
  }

  async findItems(
    user: JwtPayload,
    restaurantIdQuery?: string,
    categoryId?: string,
  ) {
    const restaurantId = this.authorization.resolveRestaurantId(
      user,
      restaurantIdQuery,
    );

    return this.prisma.menuItem.findMany({
      where: {
        restaurantId,
        ...(categoryId ? { categoryId } : {}),
      },
      include: { category: true },
      orderBy: { name: 'asc' },
    });
  }

  async findItem(id: string, user: JwtPayload) {
    const item = await this.prisma.menuItem.findUnique({
      where: { id },
      include: { category: true },
    });

    if (!item) {
      throw new NotFoundException('Menu item not found');
    }

    await this.authorization.canAccessRestaurant(user, item.restaurantId);
    return item;
  }

  async updateItem(id: string, user: JwtPayload, dto: UpdateMenuItemDto) {
    const item = await this.findItem(id, user);

    if (dto.categoryId) {
      const category = await this.prisma.menuCategory.findUnique({
        where: { id: dto.categoryId },
      });

      if (!category || category.restaurantId !== item.restaurantId) {
        throw new BadRequestException(
          'Category not found for this restaurant',
        );
      }
    }

    return this.prisma.menuItem.update({
      where: { id },
      data: dto,
    });
  }

  async removeItem(id: string, user: JwtPayload) {
    await this.findItem(id, user);

    return this.prisma.menuItem.update({
      where: { id },
      data: { active: false },
    });
  }

  async createModifierGroup(user: JwtPayload, dto: CreateModifierGroupDto) {
    const item = await this.findItem(dto.menuItemId, user);

    if ((dto.minSelect ?? 0) > (dto.maxSelect ?? 1)) {
      throw new BadRequestException('minSelect cannot exceed maxSelect');
    }

    return this.prisma.modifierGroup.create({
      data: {
        menuItemId: item.id,
        name: dto.name,
        minSelect: dto.minSelect ?? 0,
        maxSelect: dto.maxSelect ?? 1,
        required: dto.required ?? false,
        displayOrder: dto.displayOrder ?? 0,
        options: {
          create: dto.options.map((option, index) => ({
            name: option.name,
            priceDelta: option.priceDelta ?? 0,
            displayOrder: option.displayOrder ?? index,
            active: option.active ?? true,
          })),
        },
      },
      include: { options: true },
    });
  }

  async listModifierGroups(menuItemId: string, user: JwtPayload) {
    await this.findItem(menuItemId, user);

    return this.prisma.modifierGroup.findMany({
      where: { menuItemId },
      include: { options: { orderBy: { displayOrder: 'asc' } } },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async removeModifierGroup(id: string, user: JwtPayload) {
    const group = await this.prisma.modifierGroup.findUnique({
      where: { id },
      include: { menuItem: true },
    });

    if (!group) {
      throw new NotFoundException('Modifier group not found');
    }

    await this.authorization.canAccessRestaurant(
      user,
      group.menuItem.restaurantId,
    );

    return this.prisma.modifierGroup.delete({ where: { id } });
  }
}
