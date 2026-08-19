import { UnauthorizedException } from '@nestjs/common';

export type QrTokenTable = {
  qrToken: string | null;
  qrCode: string | null;
  qrTokenExpiresAt: Date | null;
};

export function assertGuestTokenValid(
  expiresAt: Date | null | undefined,
  message: string,
) {
  if (!expiresAt || expiresAt.getTime() <= Date.now()) {
    throw new UnauthorizedException(message);
  }
}

export function assertQrTokenValid(table: QrTokenTable) {
  assertGuestTokenValid(
    table.qrTokenExpiresAt,
    'This table QR code has expired. Ask staff for a new one.',
  );
}

export function assertWalkInTokenValid(expiresAt: Date | null | undefined) {
  assertGuestTokenValid(
    expiresAt,
    'This walk-in QR code has expired. Ask staff for a new one.',
  );
}

export function qrTokenExpiryFromNow(ttlDays: number): Date {
  const days = Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : 90;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
