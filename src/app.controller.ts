import { Controller, Get, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { CurrentUser } from './auth/decorators/current-user.decorator';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';

@Controller()
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @SkipThrottle()
  @Get('health')
  health() {
    return { ok: true, service: 'restaurant-api' };
  }

  @SkipThrottle()
  @Get('ready')
  async ready() {
    await this.prisma.$queryRaw`SELECT 1`;
    const redisOk = this.redis.isEnabled();
    return {
      ok: true,
      database: true,
      redis: redisOk,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  profile(@CurrentUser() user: unknown) {
    return user;
  }
}
