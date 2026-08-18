import { durationToSeconds, refreshTtlDays } from './ttl.util';

describe('durationToSeconds', () => {
  it('parses unit suffixes', () => {
    expect(durationToSeconds('15m')).toBe(900);
    expect(durationToSeconds('1h')).toBe(3600);
    expect(durationToSeconds('30s')).toBe(30);
  });

  it('accepts raw seconds and falls back', () => {
    expect(durationToSeconds('120')).toBe(120);
    expect(durationToSeconds('nope')).toBe(900);
    expect(durationToSeconds(undefined)).toBe(900);
  });
});

describe('refreshTtlDays', () => {
  it('uses a positive day count', () => {
    expect(refreshTtlDays('7')).toBe(7);
    expect(refreshTtlDays(undefined)).toBe(14);
    expect(refreshTtlDays('0')).toBe(14);
  });
});
