import { describe, expect, it } from 'vitest';
import { parseWav } from './wav.ts';

function wav({ sampleRate = 16000, channels = 1, bits = 16, format = 1, extraChunk = false, samples = 160 }) {
  const dataBytes = samples * channels * (bits / 8);
  const list = extraChunk ? Buffer.concat([Buffer.from('LIST'), u32(4), Buffer.from('INFO')]) : Buffer.alloc(0);
  const fmt = Buffer.concat([
    Buffer.from('fmt '), u32(16), u16(format), u16(channels), u32(sampleRate),
    u32(sampleRate * channels * (bits / 8)), u16(channels * (bits / 8)), u16(bits),
  ]);
  const data = Buffer.concat([Buffer.from('data'), u32(dataBytes), Buffer.alloc(dataBytes, 7)]);
  const body = Buffer.concat([Buffer.from('WAVE'), fmt, list, data]);
  return Buffer.concat([Buffer.from('RIFF'), u32(body.length), body]);
}
function u16(n: number) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u32(n: number) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }

describe('parseWav', () => {
  it('reads format and PCM data, skipping unknown chunks', () => {
    const parsed = parseWav(wav({ extraChunk: true, samples: 16000 }));
    expect(parsed.sampleRate).toBe(16000);
    expect(parsed.channels).toBe(1);
    expect(parsed.pcm.length).toBe(32000);
    expect(parsed.durationMs).toBe(1000);
    expect(parsed.bytesPerMs).toBe(32);
  });

  it('rejects anything but 16-bit PCM', () => {
    expect(() => parseWav(wav({ bits: 24 }))).toThrow(/16-bit PCM/);
    expect(() => parseWav(wav({ format: 3, bits: 32 }))).toThrow(/16-bit PCM/);
    expect(() => parseWav(Buffer.from('not a wav file at all'))).toThrow(/RIFF/);
  });
});
