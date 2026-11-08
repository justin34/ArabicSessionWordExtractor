import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeyedSpeechToText, KeyedTranslator, NO_TRANSCRIPTION_KEY, type ApiKeys } from '../src/core/apiKeys';
import { createApp, type App } from '../src/core/app';
import { FakeArabicAnalyzer, FakeDictionary, FakeTranslator } from '../src/core/fakes';
import type { Providers, Translator } from '../src/core/providers';
import { SonioxSpeechToText } from '../src/core/stt/soniox';
import { GoogleTranslator } from '../src/core/translation/google';
import type { Connect } from '../src/core/stt/socket';
import type { LiveUtterance } from '../src/core/types';
import { FakeSocket, settle } from './stt/fakeSocket';

/**
 * A dropped stream, a provider error or a missing key may stop the Transcript, but never
 * the recording: every audio chunk still reaches the Desktop (and Mic) Track, and the
 * Session completes as usual.
 */

let dir: string;
let app: App | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ill-resilience-'));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  app?.close();
  app = undefined;
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/** Soniox over a fake socket the test plays the server of; `socket` is the latest opened. */
function sonioxOverFakeSocket() {
  const sockets: FakeSocket[] = [];
  const connect: Connect = (url, protocols) => {
    const socket = new FakeSocket(url, protocols);
    sockets.push(socket);
    return socket;
  };
  return {
    speechToText: new SonioxSpeechToText({ apiKey: 'sk', connect }),
    get socket() {
      return sockets.at(-1)!;
    },
  };
}

const word = (text: string, start: number) => ({ text, start_ms: start, end_ms: start + 400, is_final: true });

function open(overrides: Partial<Providers> | ((keys: ApiKeys) => Providers)) {
  const base: Providers = {
    speechToText: sonioxOverFakeSocket().speechToText,
    translator: new FakeTranslator({ 'مرحبا بكم': 'Welcome' }),
    arabicAnalyzer: new FakeArabicAnalyzer(),
    dictionary: new FakeDictionary({}),
  };
  app = createApp({
    dataDir: dir,
    providers: typeof overrides === 'function' ? overrides : { ...base, ...overrides },
  });
  const failures: Array<[number, string]> = [];
  const updates: LiveUtterance[] = [];
  app.sessions.subscribeTranscriptionFailures((id, message) => failures.push([id, message]));
  app.sessions.subscribe((_id, u) => updates.push(u));
  return { app, failures, updates };
}

const bytes = (path: string) => [...readFileSync(path)];

describe('Recording when speech-to-text fails', () => {
  it('keeps recording through a dropped stream, keeping the Utterances heard before it', async () => {
    const soniox = sonioxOverFakeSocket();
    const { app, failures } = open({ speechToText: soniox.speechToText });
    const s = app.sessions.start('webm', { mic: true });
    await settle();
    soniox.socket.open();
    app.sessions.appendDesktopAudio(s.id, new Uint8Array([1]));
    soniox.socket.receive({ tokens: [word(' مرحبا', 0), word(' بكم', 500), { text: '<end>', is_final: true }] });
    await settle();

    soniox.socket.drop(1006, 'network lost');
    await settle();
    app.sessions.appendDesktopAudio(s.id, new Uint8Array([2]));
    app.sessions.appendMicAudio(s.id, new Uint8Array([9]));
    app.sessions.appendDesktopAudio(s.id, new Uint8Array([3]));

    expect(failures).toEqual([[s.id, 'stt-rt.soniox.com closed the stream: 1006 network lost']]);
    expect(app.sessions.transcriptionFailure(s.id)).toMatch(/1006/);
    const done = await app.sessions.stop(s.id);
    expect(done.status).toBe('completed');
    expect(bytes(done.desktopTrackPath)).toEqual([1, 2, 3]);
    expect(bytes(done.micTrackPath!)).toEqual([9]);
    expect(app.sessions.transcript(s.id).map((u) => [u.text, u.translation])).toEqual([['مرحبا بكم', 'Welcome']]);
  });

  it('keeps recording when the service reports an error mid-stream', async () => {
    const soniox = sonioxOverFakeSocket();
    const { app, failures } = open({ speechToText: soniox.speechToText });
    const s = app.sessions.start();
    await settle();
    soniox.socket.open();
    app.sessions.appendDesktopAudio(s.id, new Uint8Array([1]));
    soniox.socket.receive({ error_code: 503, error_message: 'Service unavailable' });
    await settle();
    app.sessions.appendDesktopAudio(s.id, new Uint8Array([2]));

    expect(failures.map(([, m]) => m)).toEqual(['Soniox error 503: Service unavailable']);
    const done = await app.sessions.stop(s.id);
    expect(bytes(done.desktopTrackPath)).toEqual([1, 2]);
  });

  it('keeps recording when the service refuses the connection, e.g. a bad key', async () => {
    const soniox = sonioxOverFakeSocket();
    const { app, failures } = open({ speechToText: soniox.speechToText });
    const s = app.sessions.start();
    await settle();
    soniox.socket.drop(1008, 'Invalid API key');
    await settle();
    app.sessions.appendDesktopAudio(s.id, new Uint8Array([7]));

    expect(failures.map(([, m]) => m)).toEqual(['Could not connect to stt-rt.soniox.com: 1008 Invalid API key']);
    expect(bytes((await app.sessions.stop(s.id)).desktopTrackPath)).toEqual([7]);
  });

  it('counts a stream the service ends while recording as dropped', async () => {
    const soniox = sonioxOverFakeSocket();
    const { app, failures } = open({ speechToText: soniox.speechToText });
    const s = app.sessions.start();
    await settle();
    soniox.socket.open();
    soniox.socket.receive({ tokens: [], finished: true });
    await settle();
    app.sessions.appendDesktopAudio(s.id, new Uint8Array([5]));

    expect(failures.map(([, m]) => m)).toEqual(['The speech-to-text service ended the stream early.']);
    expect(bytes((await app.sessions.stop(s.id)).desktopTrackPath)).toEqual([5]);
  });

  it('records without a Transcript when there is no speech-to-text key, saying so', async () => {
    const { app, failures } = open((keys) => ({
      speechToText: new KeyedSpeechToText(keys),
      translator: new KeyedTranslator(keys),
      arabicAnalyzer: new FakeArabicAnalyzer(),
      dictionary: new FakeDictionary({}),
    }));
    const s = app.sessions.start();
    await settle();
    app.sessions.appendDesktopAudio(s.id, new Uint8Array([1, 2]));

    expect(failures).toEqual([[s.id, NO_TRANSCRIPTION_KEY]]);
    const done = await app.sessions.stop(s.id);
    expect(done.status).toBe('completed');
    expect(bytes(done.desktopTrackPath)).toEqual([1, 2]);
  });

  it('reports nothing when the Session is stopped normally, and forgets the failure once it ends', async () => {
    const soniox = sonioxOverFakeSocket();
    const { app, failures } = open({ speechToText: soniox.speechToText });
    const s = app.sessions.start();
    await settle();
    soniox.socket.open();
    const stopping = app.sessions.stop(s.id);
    await settle();
    soniox.socket.receive({ tokens: [], finished: true });
    await stopping;

    expect(failures).toEqual([]);
    expect(app.sessions.transcriptionFailure(s.id)).toBeUndefined();
  });

  it('a new Session after a failed one transcribes again', async () => {
    const soniox = sonioxOverFakeSocket();
    const { app, failures } = open({ speechToText: soniox.speechToText });
    const first = app.sessions.start();
    await settle();
    soniox.socket.drop(1006);
    await settle();
    await app.sessions.stop(first.id);

    const second = app.sessions.start();
    await settle();
    soniox.socket.open();
    soniox.socket.receive({ tokens: [word(' مرحبا', 0), word(' بكم', 500), { text: '<end>', is_final: true }] });
    await settle();
    const stopping = app.sessions.stop(second.id);
    await settle();
    soniox.socket.receive({ tokens: [], finished: true });
    await stopping;

    expect(failures.map(([id]) => id)).toEqual([first.id]);
    expect(app.sessions.transcript(second.id).map((u) => u.text)).toEqual(['مرحبا بكم']);
  });
});

describe('Recording when translation fails', () => {
  it('keeps recording and transcribing when the network drops under Google Translation', async () => {
    let online = false;
    const fetch = (async () => {
      if (!online) throw new TypeError('fetch failed');
      return new Response(JSON.stringify({ data: { translations: [{ translatedText: 'How are you' }] } }));
    }) as unknown as typeof globalThis.fetch;
    const translator: Translator = new GoogleTranslator({ apiKey: 'AIza', fetch });
    const soniox = sonioxOverFakeSocket();
    const { app, failures, updates } = open({ speechToText: soniox.speechToText, translator });
    const s = app.sessions.start();
    await settle();
    soniox.socket.open();

    app.sessions.appendDesktopAudio(s.id, new Uint8Array([1]));
    soniox.socket.receive({ tokens: [word(' مرحبا', 0), word(' بكم', 500), { text: '<end>', is_final: true }] });
    await settle();
    online = true;
    app.sessions.appendDesktopAudio(s.id, new Uint8Array([2]));
    soniox.socket.receive({ tokens: [word(' كيف', 1500), word(' حالك', 2000), { text: '<end>', is_final: true }] });
    await settle();
    const stopping = app.sessions.stop(s.id);
    await settle();
    soniox.socket.receive({ tokens: [], finished: true });
    const done = await stopping;

    expect(failures).toEqual([]);
    expect(bytes(done.desktopTrackPath)).toEqual([1, 2]);
    expect(app.sessions.transcript(s.id).map((u) => [u.text, u.translation])).toEqual([
      ['مرحبا بكم', ''],
      ['كيف حالك', 'How are you'],
    ]);
    expect(updates.some((u) => u.translationError === 'fetch failed')).toBe(true);
  });
});
