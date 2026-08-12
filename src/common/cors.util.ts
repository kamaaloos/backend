import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/** Vercel preview/production app URLs (e.g. customer-git-main-acme.vercel.app). */
const VERCEL_APP_ORIGIN =
  /^https:\/\/[\w.-]+\.vercel\.app$/;

function parseOrigins(raw?: string): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function isTruthyFlag(value?: string): boolean {
  return value === '1' || value === 'true' || value === 'TRUE';
}

export function buildCorsOptions(input: {
  corsOrigin?: string;
  allowVercelPreviews?: string;
  isProd?: boolean;
}): CorsOptions {
  const explicit = parseOrigins(input.corsOrigin);
  const allowVercelPreviews = isTruthyFlag(input.allowVercelPreviews);

  if (input.isProd && explicit.length === 0 && !allowVercelPreviews) {
    throw new Error(
      'CORS_ORIGIN must be set in production (comma-separated origins), or set CORS_ALLOW_VERCEL_PREVIEWS=1 for Vercel preview frontends',
    );
  }

  if (explicit.length === 0) {
    return { origin: true, credentials: true };
  }

  if (!allowVercelPreviews) {
    return { origin: explicit, credentials: true };
  }

  return {
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (explicit.includes(origin) || VERCEL_APP_ORIGIN.test(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked origin: ${origin}`), false);
    },
  };
}
