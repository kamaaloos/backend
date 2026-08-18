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

function normalizeUrlList(
  urls?: string[] | null,
  max = 12,
): string[] | undefined {
  if (urls === undefined) return undefined;
  if (urls == null) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const v = raw?.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeBackgroundUrls(
  urls?: string[] | null,
): string[] | undefined {
  return normalizeUrlList(urls, 12);
}

@Injectable()
export class RestaurantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  async create(dto: CreateRestaurantDto) {
    const slug =
      dto.slug?.trim().toLowerCase() ||
      slugify(dto.name, {
        lower: true,
        strict: true,
        trim: true,
      });

    const exists = await this.prisma.restaurant.findUnique({
      where: { slug },
    });

    if (exists) {
      throw new ConflictException('Restaurant slug already in use');
    }

    const backgroundUrls = normalizeBackgroundUrls(dto.brandBackgroundUrls);
    const backgroundUrl =
      backgroundUrls !== undefined
        ? backgroundUrls[0] ?? null
        : emptyToNull(dto.brandBackgroundUrl);

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
        brandBackgroundUrl: backgroundUrl,
        brandBackgroundUrls: backgroundUrls ?? [],
        qrFrameColor: emptyToNull(dto.qrFrameColor),
        qrModuleColor: emptyToNull(dto.qrModuleColor),
        menuImageUrls: normalizeUrlList(dto.menuImageUrls, 80) ?? [],
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

    const backgroundUrls = normalizeBackgroundUrls(dto.brandBackgroundUrls);
    const menuImageUrls = normalizeUrlList(dto.menuImageUrls, 80);

    const data: UpdateRestaurantDto & {
      slug?: string;
      brandBackgroundUrls?: string[];
      menuImageUrls?: string[];
    } = {
      ...dto,
      logoUrl: dto.logoUrl !== undefined ? emptyToNull(dto.logoUrl) : undefined,
      brandAccent:
        dto.brandAccent !== undefined ? emptyToNull(dto.brandAccent) : undefined,
      brandButton:
        dto.brandButton !== undefined ? emptyToNull(dto.brandButton) : undefined,
      brandPaper:
        dto.brandPaper !== undefined ? emptyToNull(dto.brandPaper) : undefined,
      qrFrameColor:
        dto.qrFrameColor !== undefined
          ? emptyToNull(dto.qrFrameColor)
          : undefined,
      qrModuleColor:
        dto.qrModuleColor !== undefined
          ? emptyToNull(dto.qrModuleColor)
          : undefined,
      brandBackgroundUrl:
        backgroundUrls !== undefined
          ? backgroundUrls[0] ?? null
          : dto.brandBackgroundUrl !== undefined
            ? emptyToNull(dto.brandBackgroundUrl)
            : undefined,
      brandBackgroundUrls: backgroundUrls,
      menuImageUrls,
    };

    // Explicit slug only — renaming should not break restaurant subdomains.
    if (dto.slug !== undefined) {
      const slug = dto.slug.trim().toLowerCase();
      if (!slug) {
        throw new ConflictException('Slug cannot be empty');
      }
      const exists = await this.prisma.restaurant.findFirst({
        where: { slug, NOT: { id } },
      });
      if (exists) {
        throw new ConflictException('Restaurant slug already in use');
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
