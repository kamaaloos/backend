import { createHmac, timingSafeEqual } from 'crypto';

export const TABLE_PRESENCE_COOKIE = 'ms_tp';
export const TABLE_PRESENCE_PATH = '/api/customer';

export type TablePresencePayload = {
  tableId: string;
  pinVersion: number;
  exp: number;
};

export function endOfDayInTimezone(timezone: string, from = new Date()): Date {
  const dayKey = from.toLocaleDateString('en-CA', { timeZone: timezone });
  const start = from.getTime();
  for (let t = start + 60_000; t < start + 48 * 3_600_000; t += 60_000) {
    const key = new Date(t).toLocaleDateString('en-CA', { timeZone: timezone });
    if (key !== dayKey) {
      return new Date(t - 1);
    }
  }
  return new Date(start + 24 * 3_600_000);
}

export function signTablePresenceToken(
  payload: TablePresencePayload,
  secret: string,
): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyTablePresenceToken(
  token: string,
  secret: string,
): TablePresencePayload | null {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as TablePresencePayload;
    if (
      typeof parsed.tableId !== 'string' ||
      typeof parsed.pinVersion !== 'number' ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }
    if (parsed.exp <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseTablePresenceCookie(
  header: string | undefined,
  secret: string,
): TablePresencePayload | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== TABLE_PRESENCE_COOKIE) continue;
    let raw: string;
    try {
      raw = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      raw = part.slice(idx + 1).trim();
    }
    return verifyTablePresenceToken(raw, secret);
  }
  return null;
}

export function isPresenceValidForTable(
  payload: TablePresencePayload | null,
  tableId: string,
  pinVersion: number,
): payload is TablePresencePayload {
  return (
    payload != null &&
    payload.tableId === tableId &&
    payload.pinVersion === pinVersion &&
    payload.exp > Date.now()
  );
}
