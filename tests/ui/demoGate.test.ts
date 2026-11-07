import { describe, expect, it } from 'vitest';
import { demoFeedForBuild } from '../../src/renderer/demoFeed';

describe('Demo Session build gate', () => {
  it('is available in dev builds', () => {
    expect(demoFeedForBuild(true)).toBeTypeOf('function');
  });

  it('is hidden in packaged builds', () => {
    expect(demoFeedForBuild(false)).toBeUndefined();
  });
});
