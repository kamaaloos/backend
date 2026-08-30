import {
  evaluateSlo,
  percentile,
  summarizeDurations,
} from './slo';

describe('slo helpers', () => {
  it('percentile returns null for empty', () => {
    expect(percentile([], 95)).toBeNull();
  });

  it('percentile p95 on ten samples', () => {
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(samples, 95)).toBe(10);
  });

  it('summarizeDurations averages', () => {
    const summary = summarizeDurations([10, 20, 30]);
    expect(summary.sampleCount).toBe(3);
    expect(summary.averageSeconds).toBe(20);
    expect(summary.p95Seconds).toBe(30);
  });

  it('evaluateSlo', () => {
    expect(evaluateSlo(null, 100)).toBe('insufficient_data');
    expect(evaluateSlo(50, 100)).toBe('ok');
    expect(evaluateSlo(101, 100)).toBe('breach');
  });
});
