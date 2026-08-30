import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import { secretsMatch } from '../secrets-match.util';

/**
 * Protects Prometheus scrape + SLO endpoints.
 * Production requires METRICS_TOKEN. Local/dev allows open scrape when unset.
 */
@Injectable()
export class MetricsAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('METRICS_TOKEN')?.trim() ?? '';
    const isProd = this.config.get('NODE_ENV') === 'production';

    if (!expected) {
      if (isProd) {
        throw new UnauthorizedException(
          'METRICS_TOKEN is not set — scrape endpoints are locked',
        );
      }
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const provided = scrapeToken(req);
    if (!secretsMatch(provided, expected)) {
      throw new UnauthorizedException('Invalid or missing metrics token');
    }
    return true;
  }
}

export function scrapeToken(req: Request): string | null {
  const header = req.headers['x-metrics-token'];
  if (typeof header === 'string' && header.trim()) {
    return header.trim();
  }
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && /^bearer\s+/i.test(auth)) {
    const token = auth.replace(/^bearer\s+/i, '').trim();
    return token || null;
  }
  return null;
}
