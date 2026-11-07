import { describe, expect, it } from 'vitest';
import { deepgramUrl, parseDeepgramMessage } from './deepgram.ts';

const results = (overrides: Record<string, unknown>) => ({
  type: 'Results',
  start: 1.5,
  duration: 2,
  is_final: false,
  speech_final: false,
  channel: {
    alternatives: [{
      transcript: 'مرحبا بكم',
      words: [
        { word: 'مرحبا', start: 1.6, end: 2.1 },
        { word: 'بكم', start: 2.2, end: 2.9 },
      ],
    }],
  },
  ...overrides,
});

describe('parseDeepgramMessage', () => {
  it('maps interim Results to an interim event timed by its words', () => {
    expect(parseDeepgramMessage(results({}))).toEqual({
      type: 'interim', text: 'مرحبا بكم', startMs: 1600, endMs: 2900, endpoint: false,
    });
  });

  it('maps is_final to final and speech_final to an endpoint', () => {
    expect(parseDeepgramMessage(results({ is_final: true, speech_final: true }))).toMatchObject({
      type: 'final', endpoint: true,
    });
  });

  it('falls back to start and duration when there are no words, and skips empty interims', () => {
    const empty = results({ channel: { alternatives: [{ transcript: '', words: [] }] } });
    expect(parseDeepgramMessage(empty)).toBeNull();
    expect(parseDeepgramMessage({ ...empty, is_final: true, speech_final: true })).toEqual({
      type: 'final', text: '', startMs: 1500, endMs: 3500, endpoint: true,
    });
  });

  it('ignores non-Results messages', () => {
    expect(parseDeepgramMessage({ type: 'Metadata' })).toBeNull();
  });
});

describe('deepgramUrl', () => {
  it('asks for raw linear16 audio, interim results and the chosen language', () => {
    const url = new URL(deepgramUrl({ sampleRate: 16000, channels: 1, language: 'ar' }));
    expect(url.origin + url.pathname).toBe('wss://api.deepgram.com/v1/listen');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      model: 'nova-3', language: 'ar', encoding: 'linear16', sample_rate: '16000',
      channels: '1', interim_results: 'true', punctuate: 'true',
    });
  });
});
