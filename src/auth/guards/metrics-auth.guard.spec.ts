import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import { MetricsAuthGuard, scrapeToken } from './metrics-auth.guard';

function req(headers: Request['headers']): Request {
  return { headers } as Request;
}

function guard(env: Record<string, string | undefined>) {
  const config = {
    get: (key: string) => env[key],
  } as ConfigService;
  return new MetricsAuthGuard(config);
}

function http(headers: Request['headers']) {
  return {
    switchToHttp: () => ({
      getRequest: () => req(headers),
    }),
  } as never;
}

describe('scrapeToken', () => {
  it('reads Bearer and X-Metrics-Token', () => {
    expect(scrapeToken(req({ authorization: 'Bearer secret-1' }))).toBe(
      'secret-1',
    );
    expect(scrapeToken(req({ 'x-metrics-token': 'secret-2' }))).toBe(
      'secret-2',
    );
    expect(scrapeToken(req({}))).toBeNull();
  });
});

describe('MetricsAuthGuard', () => {
  it('allows unauthenticated scrapes in development when unset', () => {
    expect(guard({ NODE_ENV: 'development' }).canActivate(http({}))).toBe(
      true,
    );
  });

  it('locks scrapes in production when unset', () => {
    expect(() =>
      guard({ NODE_ENV: 'production' }).canActivate(http({})),
    ).toThrow(UnauthorizedException);
  });

  it('requires a matching token when configured', () => {
    const g = guard({
      NODE_ENV: 'production',
      METRICS_TOKEN: 'scrape-secret',
    });
    expect(() => g.canActivate(http({}))).toThrow(UnauthorizedException);
    expect(
      g.canActivate(http({ authorization: 'Bearer scrape-secret' })),
    ).toBe(true);
    expect(() =>
      g.canActivate(http({ authorization: 'Bearer wrong' })),
    ).toThrow(UnauthorizedException);
  });
});
