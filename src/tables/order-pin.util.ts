import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';

/** 4-digit PIN for printed table cards. */
export function generateOrderPin(): string {
  return String(randomInt(1000, 10000));
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
