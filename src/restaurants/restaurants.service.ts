import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import slugify from 'slugify';

import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { AuthorizationService } from '../common/authorization/authorization.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

function emptyToNull(value?: string | null): string | null | undefined {
  if (value === undefined) return undefined;
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

@Injectable()
export class RestaurantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  async create(dto: CreateRestaurantDto) {
    const slug = slugify(dto.name, {
      lower: true,
      strict: true,
      trim: true,
    });

    const exists = await this.prisma.restaurant.findUnique({
      where: { slug },
    });

    if (exists) {
      throw new ConflictException('Restaurant already exists');
    }

    return this.prisma.restaurant.create({
      data: {
        name: dto.name,
        slug,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        logoUrl: emptyToNull(dto.logoUrl),
        brandAccent: emptyToNull(dto.brandAccent),
        brandButton: emptyToNull(dto.brandButton),
        brandPaper: emptyToNull(dto.brandPaper),
        brandBackgroundUrl: emptyToNull(dto.brandBackgroundUrl),
      },
    });
  }

  findAll(user: JwtPayload) {
    if (user.role === UserRole.PLATFORM_ADMIN) {
      return this.prisma.restaurant.findMany({
        orderBy: { name: 'asc' },
      });
    }

    if (!user.restaurantId) {
      throw new ForbiddenException('User is not assigned to a restaurant.');
    }

    return this.prisma.restaurant.findMany({
      where: { id: user.restaurantId },
    });
  }

  async findOne(id: string, user: JwtPayload) {
    await this.authorization.canAccessRestaurant(user, id);

    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id },
    });

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    return restaurant;
  }

  async update(id: string, dto: UpdateRestaurantDto, user: JwtPayload) {
    await this.findOne(id, user);

    const data: UpdateRestaurantDto & { slug?: string } = {
      ...dto,
      logoUrl: dto.logoUrl !== undefined ? emptyToNull(dto.logoUrl) : undefined,
      brandAccent:
        dto.brandAccent !== undefined ? emptyToNull(dto.brandAccent) : undefined,
      brandButton:
        dto.brandButton !== undefined ? emptyToNull(dto.brandButton) : undefined,
      brandPaper:
        dto.brandPaper !== undefined ? emptyToNull(dto.brandPaper) : undefined,
      brandBackgroundUrl:
        dto.brandBackgroundUrl !== undefined
          ? emptyToNull(dto.brandBackgroundUrl)
          : undefined,
    };

    if (dto.name) {
      const slug = slugify(dto.name, {
        lower: true,
        strict: true,
        trim: true,
      });
      const exists = await this.prisma.restaurant.findFirst({
        where: { slug, NOT: { id } },
      });
      if (exists) {
        throw new ConflictException('Restaurant already exists');
      }
      data.slug = slug;
    }

    return this.prisma.restaurant.update({
      where: { id },
      data,
    });
  }

  async remove(id: string, user: JwtPayload) {
    await this.findOne(id, user);

    // Soft-delete so related users/orders/branches are not orphaned mid-op.
    return this.prisma.restaurant.update({
      where: { id },
      data: { active: false },
    });
  }
}
