import { describe, expect, it } from 'vitest';
import { gateSamples, wavChunks } from '../src/renderer/micRecordingGate';

/** The mic threshold applied to a stored Mic Track before "Transcribe my microphone" sends it (#45). */

describe('gateSamples', () => {
  it('silences quiet stretches past the hold, keeps loud ones and the length', () => {
    const rate = 1000;
    // 1 s loud (level 0.8), then 2 s quiet (level 0.1).
    const samples = new Float32Array(3000).map((_, i) => (i < 1000 ? 0.4 : 0.05));
    const out = gateSamples(samples, rate, 0.3);

    expect(out.length).toBe(samples.length);
    expect(out[500]).toBeCloseTo(0.4);
    // Held open briefly after the level falls, then shut.
    expect(out[1200]).toBeCloseTo(0.05);
    expect(out[2500]).toBe(0);
  });
});

describe('wavChunks', () => {
  it('writes a mono 16-bit PCM WAV header and the samples, split in chunks', () => {
    const chunks = wavChunks(new Float32Array([0, 1, -1, 0.5]), 16000, 4);
    const header = new DataView(chunks[0].buffer);
    const tag = (o: number) => String.fromCharCode(...chunks[0].slice(o, o + 4));

    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(header.getUint16(22, true)).toBe(1);
    expect(header.getUint32(24, true)).toBe(16000);
    expect(header.getUint16(34, true)).toBe(16);
    expect(header.getUint32(40, true)).toBe(8);
    expect(chunks.slice(1).map((c) => c.length)).toEqual([4, 4]);
    const pcm = chunks.slice(1).flatMap((c) => {
      const v = new DataView(c.buffer);
      return [v.getInt16(0, true), v.getInt16(2, true)];
    });
    expect(pcm).toEqual([0, 32767, -32767, 16384]);
  });
});
