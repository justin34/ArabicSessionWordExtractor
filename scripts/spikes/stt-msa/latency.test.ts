import { describe, expect, it } from 'vitest';
import { summarize } from './latency.ts';

describe('summarize', () => {
  it('reports nearest-rank percentiles, mean and max', () => {
    const values = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    expect(summarize(values)).toEqual({ count: 10, p50: 500, p90: 900, p95: 1000, mean: 550, max: 1000 });
  });

  it('ignores input order', () => {
    expect(summarize([300, 100, 200])?.p50).toBe(200);
  });

  it('returns null for no samples', () => {
    expect(summarize([])).toBeNull();
  });
});
