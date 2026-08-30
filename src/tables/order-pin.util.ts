import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';

/** 6-digit PIN for printed table cards (~1e6 space; verify is rate-limited). */
export function generateOrderPin(): string {
  return String(randomInt(100_000, 1_000_000));
}

export async function hashOrderPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

export async function verifyOrderPin(
  pin: string,
  hash: string | null | undefined,
): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(pin, hash);
}
