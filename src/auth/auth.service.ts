import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import type { CookieOptions, Response } from 'express';

import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './cookie.util';
import { LoginDto } from './dto/login.dto';
import { durationToSeconds, refreshTtlDays } from './ttl.util';

type AuthUserView = {
  id: string;
  email: string;
  role: User['role'];
  restaurantId: string | null;
  branchId: string | null;
  restaurant: Awaited<ReturnType<UsersService['findRestaurantBrand']>>;
};

export type AuthSession = {
  access_token: string;
  refreshToken: string;
  expires_in: number;
  user: AuthUserView;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async login(loginDto: LoginDto): Promise<AuthSession> {
    const user = await this.usersService.findByEmail(loginDto.email);

    if (!user || !user.active) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordValid = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );

    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.issueSession(user);
  }

  async refresh(rawToken: string): Promise<AuthSession> {
    const tokenHash = hashRefreshToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!existing) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (existing.revokedAt || existing.expiresAt <= new Date()) {
      if (existing.revokedAt) {
        await this.prisma.refreshToken.updateMany({
          where: { userId: existing.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (!existing.user.active) {
      await this.prisma.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    const nextRaw = newRefreshToken();
    const days = refreshTtlDays(this.config.get<string>('JWT_REFRESH_EXPIRES_DAYS'));

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.refreshToken.create({
        data: {
          userId: existing.userId,
          tokenHash: hashRefreshToken(nextRaw),
          expiresAt: new Date(Date.now() + days * 86_400_000),
        },
      }),
    ]);

    return this.issueSession(existing.user, nextRaw);
  }

  async logout(rawToken: string | null): Promise<void> {
    if (!rawToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashRefreshToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  attachRefreshCookie(res: Response, token: string) {
    res.cookie(REFRESH_COOKIE, token, this.cookieOptions());
  }

  clearRefreshCookie(res: Response) {
    const { maxAge: _maxAge, ...options } = this.cookieOptions();
    void _maxAge;
    res.clearCookie(REFRESH_COOKIE, options);
  }

  private async issueSession(
    user: User,
    refreshToken?: string,
  ): Promise<AuthSession> {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      restaurantId: user.restaurantId,
      branchId: user.branchId,
    };

    const restaurant = user.restaurantId
      ? await this.usersService.findRestaurantBrand(user.restaurantId)
      : null;

    const rawRefresh = refreshToken ?? (await this.createRefreshToken(user.id));

    return {
      access_token: await this.jwtService.signAsync(payload),
      refreshToken: rawRefresh,
      expires_in: durationToSeconds(this.config.get<string>('JWT_EXPIRES_IN')),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        restaurantId: user.restaurantId,
        branchId: user.branchId,
        restaurant,
      },
    };
  }

  private async createRefreshToken(userId: string): Promise<string> {
    await this.prisma.refreshToken.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    });

    const raw = newRefreshToken();
    const days = refreshTtlDays(
      this.config.get<string>('JWT_REFRESH_EXPIRES_DAYS'),
    );

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashRefreshToken(raw),
        expiresAt: new Date(Date.now() + days * 86_400_000),
      },
    });

    return raw;
  }

  private cookieOptions(): CookieOptions {
    const secure = this.useSecureCookies();
    const days = refreshTtlDays(
      this.config.get<string>('JWT_REFRESH_EXPIRES_DAYS'),
    );
    return {
      httpOnly: true,
      secure,
      sameSite: secure ? 'none' : 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAge: days * 86_400_000,
    };
  }

  private useSecureCookies(): boolean {
    const flag = this.config.get<string>('COOKIE_SECURE');
    if (flag === '0' || flag === 'false') return false;
    if (flag === '1' || flag === 'true') return true;
    return this.config.get('NODE_ENV') === 'production';
  }
}

function hashRefreshToken(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}

function newRefreshToken() {
  return randomBytes(32).toString('base64url');
}
