import {
  assertQrTokenValid,
  assertWalkInTokenValid,
  qrTokenExpiryFromNow,
} from './qr-token.util';

describe('guest token expiry', () => {
  it('rejects missing and past table QR expiry', () => {
    expect(() =>
      assertQrTokenValid({
        qrToken: 't',
        qrCode: 't',
        qrTokenExpiresAt: null,
      }),
    ).toThrow(/expired/);

    expect(() =>
      assertQrTokenValid({
        qrToken: 't',
        qrCode: 't',
        qrTokenExpiresAt: new Date(Date.now() - 1000),
      }),
    ).toThrow(/expired/);
  });

  it('allows a future table QR', () => {
    expect(() =>
      assertQrTokenValid({
        qrToken: 't',
        qrCode: 't',
        qrTokenExpiresAt: new Date(Date.now() + 60_000),
      }),
    ).not.toThrow();
  });

  it('rejects an expired walk-in token', () => {
    expect(() => assertWalkInTokenValid(null)).toThrow(/walk-in/);
    expect(() =>
      assertWalkInTokenValid(new Date(Date.now() - 1000)),
    ).toThrow(/walk-in/);
  });

  it('computes a positive TTL', () => {
    const later = qrTokenExpiryFromNow(90).getTime();
    expect(later).toBeGreaterThan(Date.now() + 80 * 86_400_000);
  });
});
