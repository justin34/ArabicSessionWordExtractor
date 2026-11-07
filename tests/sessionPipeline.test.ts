import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import type { ArabicAnalyzer, Providers, SttEvent, Translator } from '../src/core/providers';
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
    { surface: 'مرحبا', startMs: 0, endMs: 600, gloss: '' },
    { surface: 'بكم', startMs: 700, endMs: 1200, gloss: '' },
  ];
  const withLemmas = tokens.map((t) => ({ ...t, lemmaId: expect.any(Number) }));
  const withoutLemmas = tokens.map((t) => ({ ...t, lemmaId: null }));

  it('stores each final word as a Token with its timing and Lemma, kept across a restart', async () => {
    const sessions = open(fakeProviders({ speechToText: new FakeSpeechToText(timed) })).sessions;
    const s = await sessions.processRecording(recordedFile([1]));
    app?.close();

    expect(open().sessions.transcript(s.id)).toEqual([
      expect.objectContaining({ text: 'مرحبا بكم', tokens: withLemmas }),
    ]);
  });

  it('sends the final update with its timed Tokens at once, and their Lemmas once analyzed', async () => {
    const sessions = open(fakeProviders({ speechToText: new FakeSpeechToText(timed) })).sessions;
    const updates: LiveUtterance[] = [];
    sessions.subscribe((_id, u) => updates.push(u));

    await sessions.processRecording(recordedFile([1]));

    // Interim, then final, then the same again as its translation and analysis fill in.
    expect(updates).toHaveLength(4);
    expect(updates[0].tokens).toEqual([]);
    expect(updates[1].tokens).toEqual(withoutLemmas);
    expect(updates.at(-1)).toMatchObject({ translation: 'Welcome', tokens: withLemmas });
  });
});

describe('Live transcript updates', () => {
  it('streams interim text that becomes final under the same id, then its translation', async () => {
    const sessions = open().sessions;
    const updates: Array<{ sessionId: number; update: LiveUtterance }> = [];
    sessions.subscribe((sessionId, update) => updates.push({ sessionId, update }));

    const s = sessions.start();
    sessions.appendDesktopAudio(s.id, new Uint8Array([1]));
    await sessions.stop(s.id);

    expect(new Set(updates.map((u) => u.sessionId))).toEqual(new Set([s.id]));
    const ids = [...new Set(updates.map((u) => u.update.id))];
    expect(ids).toHaveLength(2);
    const [first, second] = ids.map((id) => updates.map((u) => u.update).filter((u) => u.id === id));
    expect(first).toEqual([
      expect.objectContaining({ isFinal: false, text: 'مر', translation: '' }),
      expect.objectContaining({ isFinal: true, text: 'مرحبا بكم', translation: '' }),
      expect.objectContaining({ isFinal: true, text: 'مرحبا بكم', translation: 'Welcome' }),
    ]);
    expect(second).toEqual([
      expect.objectContaining({ isFinal: false, text: 'كيف' }),
      expect.objectContaining({ isFinal: true, text: 'كيف حالكم', translation: '' }),
      expect.objectContaining({ isFinal: true, text: 'كيف حالكم', translation: 'How are you all' }),
    ]);
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

describe('Sentence translation', () => {
  /** Fails on the first sentence only, like a dropped request. */
  const failingOnce = (): Translator => {
    let calls = 0;
    const fallback = new FakeTranslator({ 'كيف حالكم': 'How are you all' });
    return {
      async translate(arabic) {
        if (calls++ === 0) throw new Error('translation service down');
        return fallback.translate(arabic);
      },
    };
  };

  it('stores each final Utterance with its translation, kept across a restart', async () => {
    const s = await open().sessions.processRecording(recordedFile([1]));
    app?.close();

    expect(open().sessions.transcript(s.id).map((u) => u.translation)).toEqual([
      'Welcome',
      'How are you all',
    ]);
  });

  it('a failed translation leaves the Arabic visible and stored, and recording carries on', async () => {
    const sessions = open(fakeProviders({ translator: failingOnce() })).sessions;
    const updates: LiveUtterance[] = [];
    sessions.subscribe((_id, u) => updates.push(u));

    const s = sessions.start();
    sessions.appendDesktopAudio(s.id, new Uint8Array([1]));
    sessions.appendDesktopAudio(s.id, new Uint8Array([2]));
    const done = await sessions.stop(s.id);

    expect(done.status).toBe('completed');
    expect([...readFileSync(done.desktopTrackPath)]).toEqual([1, 2]);
    // The Arabic as usual, then the same again reporting why it has no translation.
    expect(updates.filter((u) => u.text === 'مرحبا بكم' && u.isFinal)).toEqual([
      expect.objectContaining({ translation: '' }),
      expect.objectContaining({ translation: '', translationError: 'translation service down' }),
    ]);
    expect(updates.find((u) => u.text === 'كيف حالكم' && u.translation)).not.toHaveProperty(
      'translationError',
    );
    expect(sessions.transcript(done.id)).toEqual([
      expect.objectContaining({ text: 'مرحبا بكم', translation: '' }),
      expect.objectContaining({ text: 'كيف حالكم', translation: 'How are you all' }),
    ]);
  });

  it('shows the final Arabic before its translation arrives, and waits for it on stop', async () => {
    let release!: (t: string) => void;
    const slow: Translator = { translate: () => new Promise((resolve) => (release = resolve)) };
    const once: SttEvent[] = [{ type: 'final', text: 'مرحبا بكم', startMs: 0, endMs: 1200 }];
    const sessions = open(
      fakeProviders({ speechToText: new FakeSpeechToText(once), translator: slow }),
    ).sessions;
    const updates: LiveUtterance[] = [];
    sessions.subscribe((_id, u) => updates.push(u));

    const s = sessions.start();
    let stopped = false;
    const stopping = sessions.stop(s.id).then(() => (stopped = true));
    await vi.waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toMatchObject({ isFinal: true, text: 'مرحبا بكم', translation: '' });
    expect(stopped).toBe(false);

    release('Welcome');
    await stopping;

    expect(updates.at(-1)).toMatchObject({ isFinal: true, translation: 'Welcome' });
    expect(sessions.transcript(s.id)[0].translation).toBe('Welcome');
  });
});

describe('Vocabulary', () => {
  /** A final Utterance whose words are timed one after another. */
  function final(text: string, startMs: number): SttEvent {
    const words = text.split(' ').map((w, i) => ({
      text: w,
      startMs: startMs + i * 500,
      endMs: startMs + i * 500 + 400,
    }));
    return { type: 'final', text, startMs, endMs: words.at(-1)!.endMs, words };
  }
  const lemmas = {
    كتب: 'كَتَب',
    كتبوا: 'كَتَب',
    الطالب: 'طالِب',
    الطلاب: 'طالِب',
    الدرس: 'دَرْس',
  };
  const classOne = [
    { type: 'interim', text: 'كتب', startMs: 0, endMs: 300 } as SttEvent,
    final('كتب الطالب الدرس.', 0),
    final('الطلاب كتبوا', 2000),
  ];
  const classTwo = [final('كتب الطالب', 0)];

  const providersFor = (script: SttEvent[], analyzer: ArabicAnalyzer = new FakeArabicAnalyzer(lemmas)) =>
    fakeProviders({ speechToText: new FakeSpeechToText(script), arabicAnalyzer: analyzer });

  it('appends each new Lemma heard, with its surface forms, count and Utterances', async () => {
    const core = open(providersFor(classOne));
    const before = new Date().toISOString();

    const s = await core.sessions.processRecording(recordedFile([1]));

    const [first, second] = core.sessions.transcript(s.id).map((u) => u.id);
    const entries = core.vocabulary.list();
    expect(entries.map((e) => [e.lemma, e.surfaceForms, e.count, e.heardIn])).toEqual(
      expect.arrayContaining([
        [
          'كَتَب',
          ['كتب', 'كتبوا'],
          2,
          [
            { sessionId: s.id, utteranceId: first },
            { sessionId: s.id, utteranceId: second },
          ],
        ],
        [
          'طالِب',
          ['الطالب', 'الطلاب'],
          2,
          [
            { sessionId: s.id, utteranceId: first },
            { sessionId: s.id, utteranceId: second },
          ],
        ],
        ['دَرْس', ['الدرس'], 1, [{ sessionId: s.id, utteranceId: first }]],
      ]),
    );
    expect(entries).toHaveLength(3);
    for (const e of entries) expect(e.firstHeardAt >= before).toBe(true);
  });

  it('links every Token to its Lemma in the Vocabulary', async () => {
    const core = open(providersFor(classOne));

    const s = await core.sessions.processRecording(recordedFile([1]));

    const idOf = new Map(core.vocabulary.list().map((e) => [e.lemma, e.lemmaId]));
    expect(
      core.sessions.transcript(s.id).map((u) => u.tokens.map((t) => [t.surface, t.lemmaId])),
    ).toEqual([
      [
        ['كتب', idOf.get('كَتَب')],
        ['الطالب', idOf.get('طالِب')],
        ['الدرس.', idOf.get('دَرْس')],
      ],
      [
        ['الطلاب', idOf.get('طالِب')],
        ['كتبوا', idOf.get('كَتَب')],
      ],
    ]);
  });

  it('counts a Lemma heard again in a later Session, keeping when it was first heard', async () => {
    const one = await open(providersFor(classOne)).sessions.processRecording(recordedFile([1]));
    const firstHeard = app!.vocabulary.list().find((e) => e.lemma === 'كَتَب')!.firstHeardAt;
    app?.close();

    const core = open(providersFor(classTwo));
    const two = await core.sessions.processRecording(recordedFile([2]));

    const katab = core.vocabulary.list().find((e) => e.lemma === 'كَتَب')!;
    expect(katab).toMatchObject({ count: 3, surfaceForms: ['كتب', 'كتبوا'], firstHeardAt: firstHeard });
    expect(new Set(katab.heardIn.map((h) => h.sessionId))).toEqual(new Set([one.id, two.id]));
    expect(core.vocabulary.list()).toHaveLength(3);
  });

  it('a failed analysis leaves the Utterance stored and out of the Vocabulary, and recording carries on', async () => {
    let calls = 0;
    const fake = new FakeArabicAnalyzer(lemmas);
    const failingOnce: ArabicAnalyzer = {
      analyze: (sentence: string) =>
        calls++ === 0 ? Promise.reject(new Error('helper stopped')) : fake.analyze(sentence),
    };
    const core = open(providersFor(classOne, failingOnce));

    const s = await core.sessions.processRecording(recordedFile([1]));

    expect(s.status).toBe('completed');
    const transcript = core.sessions.transcript(s.id);
    expect(transcript.map((u) => u.text)).toEqual(['كتب الطالب الدرس.', 'الطلاب كتبوا']);
    expect(transcript[0].tokens.map((t) => t.lemmaId)).toEqual([null, null, null]);
    expect(core.vocabulary.list().map((e) => [e.lemma, e.count])).toEqual(
      expect.arrayContaining([
        ['كَتَب', 1],
        ['طالِب', 1],
      ]),
    );
    expect(core.vocabulary.list()).toHaveLength(2);
  });

  it('waits for the last analysis before the Session completes', async () => {
    let release!: () => void;
    const fake = new FakeArabicAnalyzer(lemmas);
    const slow: ArabicAnalyzer = {
      analyze: (sentence: string) =>
        new Promise<void>((resolve) => (release = resolve)).then(() => fake.analyze(sentence)),
    };
    const core = open(providersFor(classTwo, slow));
    const s = core.sessions.start();
    let stopped = false;
    const stopping = core.sessions.stop(s.id).then(() => (stopped = true));
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(stopped).toBe(false);

    release();
    await stopping;

    expect(core.vocabulary.list().map((e) => e.lemma)).toEqual(
      expect.arrayContaining(['كَتَب', 'طالِب']),
    );
  });

  it('is empty before anything is heard', () => {
    expect(open().vocabulary.list()).toEqual([]);
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
    expect(await new FakeArabicAnalyzer({ كتبوا: 'كَتَب' }).analyze('كتبوا الدرس.')).toEqual([
      { surface: 'كتبوا', lemma: 'كَتَب' },
      { surface: 'الدرس', lemma: 'الدرس' },
    ]);
    expect(await p.dictionary.lookup('كتب')).toEqual({ lemma: 'كتب', definitions: ['to write'] });
    expect(await p.dictionary.lookup('missing')).toBeUndefined();
  });
});
