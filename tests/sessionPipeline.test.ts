import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, type App } from '../src/core/app';
import {
  FakeArabicAnalyzer,
  FakeDictionary,
  FakeSpeechToText,
  FakeTranslator,
} from '../src/core/fakes';
import type { Providers, SttEvent } from '../src/core/providers';
import type { LiveUtterance } from '../src/core/types';

const script: SttEvent[] = [
  { type: 'interim', text: 'مر', startMs: 0, endMs: 300 },
  { type: 'final', text: 'مرحبا بكم', startMs: 0, endMs: 1200 },
  { type: 'interim', text: 'كيف', startMs: 1300, endMs: 1600 },
  { type: 'final', text: 'كيف حالكم', startMs: 1300, endMs: 2400 },
];

function fakeProviders(overrides: Partial<Providers> = {}): Providers {
  return {
    speechToText: new FakeSpeechToText(script),
    translator: new FakeTranslator({ 'مرحبا بكم': 'Welcome', 'كيف حالكم': 'How are you all' }),
    arabicAnalyzer: new FakeArabicAnalyzer(),
    dictionary: new FakeDictionary({}),
    ...overrides,
  };
}

let dir: string;
let app: App | undefined;

function open(providers = fakeProviders()): App {
  app = createApp({ dataDir: dir, providers });
  return app;
}

function recordedFile(bytes: number[]): string {
  const path = join(dir, 'class.webm');
  writeFileSync(path, Buffer.from(bytes));
  return path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ill-'));
});

afterEach(() => {
  app?.close();
  app = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe('Session pipeline fed a recorded audio file', () => {
  it('stores a completed Session whose Desktop Track is the recorded audio', async () => {
    const sessions = open().sessions;

    const session = await sessions.processRecording(recordedFile([1, 2, 3, 4, 5]));

    expect(session.status).toBe('completed');
    expect(session.endedAt).not.toBeNull();
    expect([...readFileSync(session.desktopTrackPath)]).toEqual([1, 2, 3, 4, 5]);
    expect(sessions.list()).toEqual([session]);
  });

  it('stores a Transcript of the final Utterances, translated, in order, with timings', async () => {
    const sessions = open().sessions;

    const session = await sessions.processRecording(recordedFile([1, 2, 3]));

    expect(sessions.transcript(session.id)).toEqual([
      expect.objectContaining({ text: 'مرحبا بكم', translation: 'Welcome', startMs: 0, endMs: 1200 }),
      expect.objectContaining({
        text: 'كيف حالكم',
        translation: 'How are you all',
        startMs: 1300,
        endMs: 2400,
      }),
    ]);
  });

  it('keeps the recorded file type for the Desktop Track', async () => {
    const path = join(dir, 'clip.wav');
    writeFileSync(path, Buffer.from([1]));

    const session = await open().sessions.processRecording(path);

    expect(session.desktopTrackPath).toMatch(/\.wav$/);
  });

  it('gives the speech-to-text provider exactly the audio that was recorded', async () => {
    const stt = new FakeSpeechToText(script);
    const sessions = open(fakeProviders({ speechToText: stt })).sessions;

    await sessions.processRecording(recordedFile([7, 8, 9]));

    expect([...stt.received]).toEqual([7, 8, 9]);
  });
});

describe('Live Session', () => {
  it('start, stream desktop audio, stop: saves the Desktop Track and the Transcript', async () => {
    const sessions = open().sessions;

    const started = sessions.start();
    expect(started.status).toBe('recording');
    expect(sessions.list()).toEqual([started]);

    sessions.appendDesktopAudio(started.id, new Uint8Array([1, 2]));
    sessions.appendDesktopAudio(started.id, new Uint8Array([3]));
    const done = await sessions.stop(started.id);

    expect(done.status).toBe('completed');
    expect([...readFileSync(done.desktopTrackPath)]).toEqual([1, 2, 3]);
    expect(sessions.transcript(done.id).map((u) => u.text)).toEqual(['مرحبا بكم', 'كيف حالكم']);
  });

  it('rejects desktop audio for a Session that is not recording', async () => {
    const sessions = open().sessions;
    const s = sessions.start();
    await sessions.stop(s.id);

    expect(() => sessions.appendDesktopAudio(s.id, new Uint8Array([1]))).toThrow(/not recording/);
  });

  it('keeps the recording when speech-to-text fails', async () => {
    const failing = {
      async *transcribe(audio: AsyncIterable<Uint8Array>): AsyncIterable<SttEvent> {
        for await (const _ of audio) throw new Error('network down');
      },
    };
    const sessions = open(fakeProviders({ speechToText: failing })).sessions;

    const s = sessions.start();
    sessions.appendDesktopAudio(s.id, new Uint8Array([4]));
    sessions.appendDesktopAudio(s.id, new Uint8Array([5]));
    const done = await sessions.stop(s.id);

    expect(done.status).toBe('completed');
    expect([...readFileSync(done.desktopTrackPath)]).toEqual([4, 5]);
  });
});

describe('Word timings', () => {
  const timed: SttEvent[] = [
    { type: 'interim', text: 'مرحبا', startMs: 0, endMs: 500, words: [] },
    {
      type: 'final',
      text: 'مرحبا بكم',
      startMs: 0,
      endMs: 1200,
      words: [
        { text: 'مرحبا', startMs: 0, endMs: 600 },
        { text: 'بكم', startMs: 700, endMs: 1200 },
      ],
    },
  ];
  const tokens = [
    { surface: 'مرحبا', startMs: 0, endMs: 600, gloss: '', lemmaId: null },
    { surface: 'بكم', startMs: 700, endMs: 1200, gloss: '', lemmaId: null },
  ];

  it('stores each final word as a Token with its timing, kept across a restart', async () => {
    const sessions = open(fakeProviders({ speechToText: new FakeSpeechToText(timed) })).sessions;
    const s = await sessions.processRecording(recordedFile([1]));
    app?.close();

    expect(open().sessions.transcript(s.id)).toEqual([
      expect.objectContaining({ text: 'مرحبا بكم', tokens }),
    ]);
  });

  it('sends the final update with its timed Tokens, and the interim one without', async () => {
    const sessions = open(fakeProviders({ speechToText: new FakeSpeechToText(timed) })).sessions;
    const updates: LiveUtterance[] = [];
    sessions.subscribe((_id, u) => updates.push(u));

    await sessions.processRecording(recordedFile([1]));

    expect(updates.map((u) => u.tokens)).toEqual([[], tokens]);
  });
});

describe('Live transcript updates', () => {
  it('streams interim text that becomes final under the same id, translated', async () => {
    const sessions = open().sessions;
    const updates: Array<{ sessionId: number; update: LiveUtterance }> = [];
    sessions.subscribe((sessionId, update) => updates.push({ sessionId, update }));

    const s = sessions.start();
    sessions.appendDesktopAudio(s.id, new Uint8Array([1]));
    await sessions.stop(s.id);

    expect(updates.map((u) => u.sessionId)).toEqual([s.id, s.id, s.id, s.id]);
    const [a, b, c, d] = updates.map((u) => u.update);
    expect(a).toMatchObject({ isFinal: false, text: 'مر', translation: '' });
    expect(b).toMatchObject({ isFinal: true, text: 'مرحبا بكم', translation: 'Welcome' });
    expect(c).toMatchObject({ isFinal: false, text: 'كيف' });
    expect(d).toMatchObject({ isFinal: true, text: 'كيف حالكم', translation: 'How are you all' });
    expect(b.id).toBe(a.id);
    expect(d.id).toBe(c.id);
    expect(c.id).not.toBe(a.id);
  });

  it('stops sending updates once unsubscribed', async () => {
    const sessions = open().sessions;
    const updates: LiveUtterance[] = [];
    const unsubscribe = sessions.subscribe((_id, u) => updates.push(u));
    unsubscribe();

    await sessions.stop(sessions.start().id);

    expect(updates).toEqual([]);
  });
});

describe('Session list', () => {
  it('lists newest Session first and survives an app restart', async () => {
    const first = open().sessions;
    const a = await first.stop(first.start().id);
    const b = await first.stop(first.start().id);
    app?.close();

    const reopened = open().sessions;
    expect(reopened.list().map((s) => s.id)).toEqual([b.id, a.id]);
  });

  it('stopAll completes every live Session, keeping their Desktop Tracks', async () => {
    const sessions = open().sessions;
    const s = sessions.start();
    sessions.appendDesktopAudio(s.id, new Uint8Array([6]));

    await sessions.stopAll();

    expect(sessions.list().map((x) => x.status)).toEqual(['completed']);
    expect([...readFileSync(s.desktopTrackPath)]).toEqual([6]);
  });

  it('completes a Session left recording by a crash when the app reopens', () => {
    const crashed = open().sessions.start();
    app?.close(); // no stop: simulates the app dying mid-recording

    const reopened = open().sessions;
    const recovered = reopened.list().find((s) => s.id === crashed.id);
    expect(recovered?.status).toBe('completed');
    expect(recovered?.endedAt).not.toBeNull();
  });
});

describe('Provider interfaces', () => {
  it('fake translator, analyzer and dictionary answer from their fixtures', async () => {
    const p = fakeProviders({
      dictionary: new FakeDictionary({ كتب: ['to write'] }),
    });

    expect(await p.translator.translate('مرحبا بكم')).toBe('Welcome');
    expect(await p.arabicAnalyzer.analyze('كتب الولد')).toEqual([
      { surface: 'كتب', lemma: 'كتب' },
      { surface: 'الولد', lemma: 'الولد' },
    ]);
    expect(await p.dictionary.lookup('كتب')).toEqual({ lemma: 'كتب', definitions: ['to write'] });
    expect(await p.dictionary.lookup('missing')).toBeUndefined();
  });
});
