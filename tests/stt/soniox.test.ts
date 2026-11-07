import { describe, expect, it } from 'vitest';
import { SonioxSpeechToText } from '../../src/core/stt/soniox';
import { settle, startStreaming } from './fakeSocket';

const token = (text: string, start: number, end: number, isFinal: boolean) => ({
  text,
  start_ms: start,
  end_ms: end,
  is_final: isFinal,
});

const start = () =>
  startStreaming((connect) => (audio) =>
    new SonioxSpeechToText({ apiKey: 'test-key', connect }).transcribe(audio),
  );

describe('Soniox speech-to-text', () => {
  it('opens a stream for Arabic, streams the audio, then signals the end of audio', async () => {
    const { audio, socket } = await start();
    socket.open();
    await settle();
    audio.push(new Uint8Array([1, 2]));
    audio.push(new Uint8Array([3]));
    audio.close();
    await settle();

    expect(socket.url).toBe('wss://stt-rt.soniox.com/transcribe-websocket');
    expect(socket.protocols).toEqual(['soniox-api-key', 'test-key']);
    const [config, ...rest] = socket.sent;
    expect(JSON.parse(config as string)).toEqual({
      model: 'stt-rt-v6',
      audio_format: 'auto',
      language_hints: ['ar'],
      language_hints_strict: true,
      enable_endpoint_detection: true,
      max_endpoint_delay_ms: 1000,
    });
    expect(rest.map((f) => (typeof f === 'string' ? f : [...f]))).toEqual([[1, 2], [3], '']);
  });

  it('shows the Utterance growing as interim text, then closes it at <end> with timed words', async () => {
    const { socket, events, done } = await start();
    socket.open();
    socket.receive({ tokens: [token('مر', 0, 200, false)] });
    // Tokens are sub-word pieces; a leading space starts a new word.
    socket.receive({
      tokens: [token('مرح', 0, 300, true), token('با', 300, 500, true), token(' ب', 600, 700, false)],
    });
    socket.receive({
      tokens: [token(' بكم', 600, 900, true), token('.', 900, 950, true), token('<end>', 0, 0, true)],
    });
    socket.receive({ tokens: [token(' كيف', 1500, 1800, false)] });
    socket.receive({ tokens: [], finished: true });
    await done;

    expect(events).toEqual([
      { type: 'interim', text: 'مر', startMs: 0, endMs: 200 },
      { type: 'interim', text: 'مرحبا ب', startMs: 0, endMs: 700 },
      {
        type: 'final',
        text: 'مرحبا بكم.',
        startMs: 0,
        endMs: 950,
        words: [
          { text: 'مرحبا', startMs: 0, endMs: 500 },
          { text: 'بكم.', startMs: 600, endMs: 950 },
        ],
      },
      { type: 'interim', text: 'كيف', startMs: 1500, endMs: 1800 },
    ]);
  });

  it('closes an Utterance left open when the service finishes', async () => {
    const { socket, events, done } = await start();
    socket.open();
    socket.receive({ tokens: [token('شكرا', 0, 400, true)] });
    socket.receive({ tokens: [], finished: true });
    await done;

    expect(events.at(-1)).toEqual({
      type: 'final',
      text: 'شكرا',
      startMs: 0,
      endMs: 400,
      words: [{ text: 'شكرا', startMs: 0, endMs: 400 }],
    });
  });

  it('fails the stream on a service error', async () => {
    const { socket, done } = await start();
    socket.open();
    socket.receive({ error_code: 401, error_message: 'Invalid API key' });

    await expect(done).rejects.toThrow(/401.*Invalid API key/);
  });

  it('fails the stream when the connection drops before the service finishes', async () => {
    const { socket, done } = await start();
    socket.open();
    socket.drop(1006);

    await expect(done).rejects.toThrow(/1006/);
  });
});
