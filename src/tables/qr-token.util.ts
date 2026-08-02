import { UnauthorizedException } from '@nestjs/common';

export type QrTokenTable = {
  qrToken: string | null;
  qrCode: string | null;
  qrTokenExpiresAt: Date | null;
};

export function assertQrTokenValid(table: QrTokenTable) {
  if (table.qrTokenExpiresAt && table.qrTokenExpiresAt.getTime() <= Date.now()) {
    throw new UnauthorizedException(
      'This table QR code has expired. Ask staff for a new one.',
    );
  }
}

export function qrTokenExpiryFromNow(ttlDays: number): Date {
  const days = Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : 90;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
