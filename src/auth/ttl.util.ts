/** Parse JWT_EXPIRES_IN values such as `15m`, `1h`, or raw seconds. */
export function durationToSeconds(
  raw: string | undefined,
  fallbackSeconds = 15 * 60,
): number {
  const value = (raw ?? '').trim();
  if (!value) return fallbackSeconds;
  if (/^\d+$/.test(value)) return Number(value);
  const match = value.match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!match) return fallbackSeconds;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 'ms':
      return Math.max(1, Math.round(amount / 1000));
    case 's':
      return amount;
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 3600;
    case 'd':
      return amount * 86400;
    default:
      return fallbackSeconds;
  }
}

export function refreshTtlDays(raw: string | undefined, fallback = 14): number {
  const days = Number(raw ?? fallback);
  return Number.isFinite(days) && days > 0 ? days : fallback;
}
