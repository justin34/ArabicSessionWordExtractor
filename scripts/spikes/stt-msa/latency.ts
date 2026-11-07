/** Summary statistics for latency samples, in milliseconds. */

export interface LatencySummary {
  count: number;
  p50: number;
  p90: number;
  p95: number;
  mean: number;
  max: number;
}

function nearestRank(sorted: readonly number[], percentile: number): number {
  const rank = Math.ceil((percentile / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

export function summarize(samples: readonly number[]): LatencySummary | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: nearestRank(sorted, 50),
    p90: nearestRank(sorted, 90),
    p95: nearestRank(sorted, 95),
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    max: sorted[sorted.length - 1],
  };
}
