import { describe, expect, it } from 'vitest';
import { SonioxAssembler, sonioxConfig } from './soniox.ts';

const token = (text: string, start: number, end: number, isFinal: boolean) =>
  ({ text, start_ms: start, end_ms: end, is_final: isFinal });

describe('SonioxAssembler', () => {
  it('emits newly final tokens as one final event and pending tokens as interim text', () => {
    const assembler = new SonioxAssembler();
    expect(assembler.feed({ tokens: [token('مر', 100, 300, true), token('حبا', 300, 600, false)] })).toEqual([
      { type: 'final', text: 'مر', startMs: 100, endMs: 300, endpoint: false },
      { type: 'interim', text: 'حبا', startMs: 300, endMs: 600, endpoint: false },
    ]);
  });

  it('turns <end> into an endpoint at the last final token', () => {
    const assembler = new SonioxAssembler();
    assembler.feed({ tokens: [token('مرحبا', 100, 600, true)] });
    expect(assembler.feed({ tokens: [token('<end>', 0, 0, true)] })).toEqual([
      { type: 'final', text: '', startMs: 600, endMs: 600, endpoint: true },
    ]);
  });

  it('marks a final event that carries <end> as an endpoint', () => {
    const events = new SonioxAssembler().feed({
      tokens: [token(' بكم', 700, 900, true), token('<end>', 0, 0, true)],
    });
    expect(events).toEqual([{ type: 'final', text: ' بكم', startMs: 700, endMs: 900, endpoint: true }]);
  });

  it('throws on a server error', () => {
    expect(() => new SonioxAssembler().feed({ error_code: 401, error_message: 'bad key' })).toThrow(/401.*bad key/);
  });
});

describe('sonioxConfig', () => {
  it('requests raw PCM, Arabic hints and endpoint detection, and carries no key', () => {
    const config = sonioxConfig({ sampleRate: 16000, channels: 1, language: 'ar' });
    expect(config).toEqual({
      model: 'stt-rt-v6', audio_format: 'pcm_s16le', sample_rate: 16000, num_channels: 1,
      language_hints: ['ar'], language_hints_strict: true, enable_endpoint_detection: true,
    });
  });
});
