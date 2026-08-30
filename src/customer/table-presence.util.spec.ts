import {
  endOfDayInTimezone,
  isPresenceValidForTable,
  signTablePresenceToken,
  verifyTablePresenceToken,
} from './table-presence.util';

describe('table-presence.util', () => {
  const secret = 'test-secret';

  it('signs and verifies presence token', () => {
    const exp = Date.now() + 60_000;
    const token = signTablePresenceToken(
      { tableId: 't1', pinVersion: 2, exp },
      secret,
    );
    const parsed = verifyTablePresenceToken(token, secret);
    expect(parsed).toEqual({ tableId: 't1', pinVersion: 2, exp });
  });

  it('rejects expired token', () => {
    const token = signTablePresenceToken(
      { tableId: 't1', pinVersion: 1, exp: Date.now() - 1 },
      secret,
    );
    expect(verifyTablePresenceToken(token, secret)).toBeNull();
  });

  it('validates table and pin version', () => {
    const payload = { tableId: 't1', pinVersion: 3, exp: Date.now() + 60_000 };
    expect(isPresenceValidForTable(payload, 't1', 3)).toBe(true);
    expect(isPresenceValidForTable(payload, 't2', 3)).toBe(false);
    expect(isPresenceValidForTable(payload, 't1', 4)).toBe(false);
  });

  it('computes end of day in timezone', () => {
    const end = endOfDayInTimezone('Europe/Helsinki', new Date('2026-08-19T12:00:00Z'));
    const key = end.toLocaleDateString('en-CA', { timeZone: 'Europe/Helsinki' });
    expect(key).toBe('2026-08-19');
    const next = new Date(end.getTime() + 2);
    const nextKey = next.toLocaleDateString('en-CA', {
      timeZone: 'Europe/Helsinki',
    });
    expect(nextKey).toBe('2026-08-20');
  });
});
