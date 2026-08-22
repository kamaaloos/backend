import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/** Vercel preview/production app URLs (e.g. customer-git-main-acme.vercel.app). */
const VERCEL_APP_ORIGIN = /^https:\/\/[\w.-]+\.vercel\.app$/;

export type CorsOriginInput = {
  corsOrigin?: string;
  allowVercelPreviews?: string;
  isProd?: boolean;
};

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

/** Convert https://*.maylesoft.com → regex matching any single subdomain. */
function originPattern(entry: string): RegExp | string {
  if (!entry.includes('*')) return entry;
  const escaped = entry.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const withWildcards = escaped.replace(/\*/g, '[\\w-]+');
  return new RegExp(`^${withWildcards}$`);
}

function originAllowed(
  origin: string,
  explicit: string[],
  allowVercelPreviews: boolean,
): boolean {
  for (const entry of explicit) {
    const pattern = originPattern(entry);
    if (typeof pattern === 'string') {
      if (pattern === origin) return true;
    } else if (pattern.test(origin)) {
      return true;
    }
  }
  if (allowVercelPreviews && VERCEL_APP_ORIGIN.test(origin)) return true;
  return false;
}

export function isCorsOriginAllowed(
  origin: string,
  input: Pick<CorsOriginInput, 'corsOrigin' | 'allowVercelPreviews'>,
): boolean {
  const explicit = parseOrigins(input.corsOrigin);
  const allowVercelPreviews = isTruthyFlag(input.allowVercelPreviews);
  return originAllowed(origin, explicit, allowVercelPreviews);
}

/**
 * Shared CORS policy for HTTP (`enableCors`) and Socket.IO (`@WebSocketGateway`).
 * Supports exact origins and wildcards such as `https://*.maylesoft.com`.
 */
export function buildCorsOptions(input: CorsOriginInput): CorsOptions {
  const explicit = parseOrigins(input.corsOrigin);
  const allowVercelPreviews = isTruthyFlag(input.allowVercelPreviews);
  const hasWildcard = explicit.some((o) => o.includes('*'));

  if (input.isProd && explicit.length === 0 && !allowVercelPreviews) {
    throw new Error(
      'CORS_ORIGIN must be set in production (comma-separated origins), or set CORS_ALLOW_VERCEL_PREVIEWS=1 for Vercel preview frontends',
    );
  }

  if (explicit.length === 0) {
    return { origin: true, credentials: true };
  }

  if (!allowVercelPreviews && !hasWildcard) {
    return { origin: explicit, credentials: true };
  }

  return {
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (originAllowed(origin, explicit, allowVercelPreviews)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked origin: ${origin}`), false);
    },
  };
}

/** Read CORS settings from `process.env` (used by Socket.IO gateway decorators). */
export function buildCorsOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CorsOptions {
  return buildCorsOptions({
    corsOrigin: env.CORS_ORIGIN,
    allowVercelPreviews: env.CORS_ALLOW_VERCEL_PREVIEWS,
    isProd: env.NODE_ENV === 'production',
  });
}
