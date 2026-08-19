/**
 * Rolling-window SLO helpers from DB samples (admin dashboard).
 */

export type SloSample = { durationSeconds: number };

export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (p <= 0) return sortedAsc[0]!;
  if (p >= 100) return sortedAsc[sortedAsc.length - 1]!;
  const idx = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.max(0, Math.min(sortedAsc.length - 1, idx))]!;
}

export function summarizeDurations(seconds: number[]) {
  const sorted = [...seconds].filter((v) => Number.isFinite(v) && v >= 0).sort(
    (a, b) => a - b,
  );
  const avg =
    sorted.length === 0
      ? null
      : Math.round(
          (sorted.reduce((sum, v) => sum + v, 0) / sorted.length) * 10,
        ) / 10;
  return {
    sampleCount: sorted.length,
    averageSeconds: avg,
    p95Seconds: percentile(sorted, 95),
  };
}

export function evaluateSlo(
  p95Seconds: number | null,
  thresholdSeconds: number,
): 'ok' | 'breach' | 'insufficient_data' {
  if (p95Seconds == null) return 'insufficient_data';
  return p95Seconds > thresholdSeconds ? 'breach' : 'ok';
}
