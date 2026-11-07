import { describe, expect, it } from 'vitest';
import { paceFrames } from './pacer.ts';

describe('paceFrames', () => {
  it('releases each frame when its last sample would exist in live capture', async () => {
    let now = 1000;
    const clock = {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    };
    const pcm = new Uint8Array(32 * 250); // 250 ms at 16 kHz mono 16-bit
    const sentAt: number[] = [];
    const sizes: number[] = [];
    for await (const frame of paceFrames(pcm, { bytesPerMs: 32, frameMs: 100, sampleBytes: 2, clock })) {
      sentAt.push(now - 1000);
      sizes.push(frame.length);
      now += 3; // time spent sending must not accumulate as drift
    }
    expect(sizes).toEqual([3200, 3200, 1600]);
    // The 250 ms of audio ends at 250 ms, so the last, half frame goes out then.
    expect(sentAt).toEqual([100, 200, 250]);
  });

  it('refuses frame sizes that would split a sample', async () => {
    const frames = paceFrames(new Uint8Array(100), { bytesPerMs: 44.1, frameMs: 5, sampleBytes: 2 });
    await expect(frames.next()).rejects.toThrow(/whole samples/);
  });
});
