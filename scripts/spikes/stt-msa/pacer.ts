/** Sends audio at real-time speed, as loopback capture would, so latency numbers mean something. */

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Yields `frameMs` slices of PCM. Time 0 of the audio is the moment the generator
 * starts; each frame is released when its last sample would exist in live capture,
 * measured from that start, so time spent sending never accumulates as drift.
 */
export async function* paceFrames(
  pcm: Uint8Array,
  {
    bytesPerMs,
    frameMs,
    sampleBytes,
    clock = realClock,
  }: { bytesPerMs: number; frameMs: number; sampleBytes: number; clock?: Clock },
): AsyncGenerator<Uint8Array> {
  const frameBytes = bytesPerMs * frameMs;
  if (!Number.isInteger(frameBytes) || frameBytes % sampleBytes !== 0) {
    throw new Error(`a ${frameMs} ms frame is ${frameBytes} bytes, not whole samples of ${sampleBytes} bytes`);
  }
  const start = clock.now();
  for (let offset = 0; offset < pcm.length; offset += frameBytes) {
    const frame = pcm.subarray(offset, offset + frameBytes);
    const wait = start + (offset + frame.length) / bytesPerMs - clock.now();
    if (wait > 0) await clock.sleep(wait);
    yield frame;
  }
}
