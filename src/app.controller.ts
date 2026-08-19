import { Controller, Get, Header, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';

import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { MetricsAuthGuard } from './auth/guards/metrics-auth.guard';
import { CurrentUser } from './auth/decorators/current-user.decorator';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';
import {
  metricsContentType,
  metricsText,
  paymentSloSeconds,
  prepSloSeconds,
} from './telemetry/metrics';

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

  /** Prometheus scrape target (process histograms + defaults). */
  @SkipThrottle()
  @UseGuards(MetricsAuthGuard)
  @Get('metrics')
  async metrics(@Res() res: Response) {
    const body = await metricsText();
    res.setHeader('Content-Type', metricsContentType());
    res.send(body);
  }

  /** Thresholds for uptime monitors / operators. */
  @SkipThrottle()
  @UseGuards(MetricsAuthGuard)
  @Get('slo')
  @Header('Cache-Control', 'no-store')
  slo() {
    return {
      prep: {
        thresholdSeconds: prepSloSeconds(),
        metric: 'restaurant_prep_duration_seconds',
      },
      paymentSettle: {
        thresholdSeconds: paymentSloSeconds(),
        metric: 'restaurant_payment_settle_duration_seconds',
      },
      scrape: '/api/metrics',
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  profile(@CurrentUser() user: unknown) {
    return user;
  }
}
