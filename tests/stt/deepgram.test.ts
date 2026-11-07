import { describe, expect, it } from 'vitest';
import { DeepgramSpeechToText } from '../../src/core/stt/deepgram';
import { settle, startStreaming } from './fakeSocket';

const start = () =>
  startStreaming((connect) => (audio) =>
    new DeepgramSpeechToText({ apiKey: 'test-key', connect }).transcribe(audio),
  );

/** A Deepgram Results message; times in seconds, as Deepgram sends them. */
const results = (
  words: Array<[string, number, number]>,
  { isFinal = false, speechFinal = false } = {},
) => ({
  type: 'Results',
  is_final: isFinal,
  speech_final: speechFinal,
  channel: {
    alternatives: [
      {
        transcript: words.map(([w]) => w).join(' '),
        words: words.map(([w, start, end]) => ({ word: w, punctuated_word: w, start, end })),
      },
    ],
  },
});

describe('Deepgram speech-to-text (fallback)', () => {
  it('connects to Nova-3 for Arabic with interim results, streams the audio, then closes the stream', async () => {
    const { audio, socket } = await start();
    socket.open();
    audio.push(new Uint8Array([1, 2]));
    audio.close();
    await settle();

    const url = new URL(socket.url);
    expect(url.origin + url.pathname).toBe('wss://api.deepgram.com/v1/listen');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      model: 'nova-3',
      language: 'ar',
      interim_results: 'true',
      punctuate: 'true',
      utterance_end_ms: '1000',
    });
    expect(socket.protocols).toEqual(['token', 'test-key']);
    expect(socket.sent.map((f) => (typeof f === 'string' ? f : [...f]))).toEqual([
      [1, 2],
      JSON.stringify({ type: 'CloseStream' }),
    ]);
  });

  it('joins final segments into one Utterance that closes at speech_final, with word timings in ms', async () => {
    const { socket, events, done } = await start();
    socket.open();
    socket.receive(results([['مرحبا', 0, 0.5]]));
    socket.receive(results([['مرحبا', 0, 0.5]], { isFinal: true }));
    socket.receive(results([['بكم', 0.6, 0.9]]));
    socket.receive(results([['بكم', 0.6, 0.95]], { isFinal: true, speechFinal: true }));
    socket.receive({ type: 'Metadata' });
    socket.drop(1000);
    await done;

    expect(events).toEqual([
      { type: 'interim', text: 'مرحبا', startMs: 0, endMs: 500 },
      { type: 'interim', text: 'مرحبا', startMs: 0, endMs: 500 },
      { type: 'interim', text: 'مرحبا بكم', startMs: 0, endMs: 900 },
      {
        type: 'final',
        text: 'مرحبا بكم',
        startMs: 0,
        endMs: 950,
        words: [
          { text: 'مرحبا', startMs: 0, endMs: 500 },
          { text: 'بكم', startMs: 600, endMs: 950 },
        ],
      },
    ]);
  });

  it('closes the open Utterance on UtteranceEnd, and when the stream ends', async () => {
    const { socket, events, done } = await start();
    socket.open();
    socket.receive(results([['نعم', 0, 0.3]], { isFinal: true }));
    socket.receive({ type: 'UtteranceEnd', last_word_end: 0.3 });
    socket.receive(results([['شكرا', 1, 1.4]], { isFinal: true }));
    socket.drop(1000);
    await done;

    expect(events.filter((e) => e.type === 'final').map((e) => e.text)).toEqual(['نعم', 'شكرا']);
  });

  it('fails the stream when Deepgram rejects the connection', async () => {
    const { socket, done } = await start();
    socket.drop(1008, 'invalid credentials');

    await expect(done).rejects.toThrow(/1008 invalid credentials/);
  });
});
