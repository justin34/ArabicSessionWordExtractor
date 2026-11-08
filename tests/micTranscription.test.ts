import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeyedRecordedSpeechToText, NO_RECORDING_TRANSCRIPTION_KEY } from '../src/core/apiKeys';
import { createApp, type App } from '../src/core/app';
import { FakeArabicAnalyzer, FakeDictionary, FakeTranslator } from '../src/core/fakes';
import type { RecordedAudio, RecordedSpeechToText, SpeechToText, SttEvent, SttWord, Translator } from '../src/core/providers';
import type { MicTranscriptionStatus } from '../src/core/types';

/**
 * "Transcribe my microphone" (#45): a completed Session with a Mic Track and no Learner
 * Utterances has its Mic Track transcribed afterwards, in the background. The Learner
 * Utterances are translated, never analyzed (ADR 0004).
 */

const TEACHER = 'كتب الطالب الدرس';
const LEARNER_1 = 'كتب الطالب كتابا.';
const LEARNER_2 = 'شكرا';

/** Words of a sentence from `startMs`, 500 ms apart. */
function words(text: string, startMs: number): SttWord[] {
  return text.split(' ').map((w, i) => ({ text: w, startMs: startMs + i * 500, endMs: startMs + i * 500 + 400 }));
}

/** Live speech-to-text: the teacher only. */
const desktopOnly: SpeechToText = {
  async *transcribe(audio): AsyncIterable<SttEvent> {
    for await (const _ of audio) void _;
    const w = words(TEACHER, 0);
    yield { type: 'final', text: TEACHER, startMs: 0, endMs: 1400, words: w };
  },
};

/** A recording's speech-to-text that answers when told to, keeping what it was given. */
class ManualRecorded implements RecordedSpeechToText {
  given: Array<RecordedAudio & { bytes: number[] }> = [];
  private settle: { resolve: (w: SttWord[]) => void; reject: (e: Error) => void } | undefined;

  transcribeFile(audio: RecordedAudio): Promise<SttWord[]> {
    this.given.push({ ...audio, bytes: [...readFileSync(audio.path)] });
    return new Promise((resolve, reject) => (this.settle = { resolve, reject }));
  }
  answer(w: SttWord[]) {
    this.settle!.resolve(w);
  }
  fail(message: string) {
    this.settle!.reject(new Error(message));
  }
}

let dir: string;
let app: App | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ill-mictx-'));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  app?.close();
  app = undefined;
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

async function completedSession(recorded?: RecordedSpeechToText, { mic = true, translator }: { mic?: boolean; translator?: Translator } = {}) {
  const analyzer = new FakeArabicAnalyzer();
  const analyze = vi.spyOn(analyzer, 'analyze');
  app = createApp({
    dataDir: dir,
    providers: {
      speechToText: desktopOnly,
      recordedSpeechToText: recorded,
      translator: translator ?? new FakeTranslator({ [TEACHER]: 'The student wrote the lesson.', [LEARNER_1]: 'The student wrote a book.', [LEARNER_2]: 'Thanks' }),
      arabicAnalyzer: analyzer,
      dictionary: new FakeDictionary({ 'كتب': ['to write'] }),
    },
  });
  // Recorded before #42 would have been: a Mic Track, never transcribed.
  const { id } = app.sessions.start('webm', { mic });
  app.sessions.appendDesktopAudio(id, new Uint8Array([1, 2]));
  if (mic) app.sessions.appendMicAudio(id, new Uint8Array([7, 8, 9]));
  await app.sessions.stop(id);
  await app.guides.idle();
  const statuses: MicTranscriptionStatus[] = [];
  app.micTranscriptions.subscribe((sessionId, s) => sessionId === id && statuses.push(s));
  return { app, id, analyze, statuses };
}

const learnerWords = () => [...words(LEARNER_1, 2000), ...words(LEARNER_2, 6000)];

describe('Transcribe my microphone', () => {
  it('turns the Mic Track into translated Learner Utterances with its timings, in the background', async () => {
    const recorded = new ManualRecorded();
    const { app, id, analyze, statuses } = await completedSession(recorded);
    analyze.mockClear();

    expect(app.micTranscriptions.refusal(id)).toBeUndefined();
    expect(app.micTranscriptions.start(id)).toMatchObject({ state: 'running' });
    await vi.waitFor(() => expect(recorded.given).toHaveLength(1));
    // The Mic Track itself, as recorded.
    expect(recorded.given[0]).toMatchObject({ contentType: 'audio/webm', bytes: [7, 8, 9] });
    expect(app.micTranscriptions.status(id)).toMatchObject({ state: 'running' });
    expect(app.micTranscriptions.refusal(id)).toMatch(/already being transcribed/);

    recorded.answer(learnerWords());
    await app.micTranscriptions.idle();

    expect(statuses.map((s) => s.state)).toEqual(['running', 'running', 'done']);
    expect(app.micTranscriptions.status(id)).toBeNull();
    const learner = app.sessions.transcript(id).filter((u) => u.track === 'mic');
    // Split at the sentence end; each at its place in the Mic Track.
    expect(learner.map((u) => [u.text, u.translation, u.startMs, u.endMs])).toEqual([
      [LEARNER_1, 'The student wrote a book.', 2000, 3400],
      [LEARNER_2, 'Thanks', 6000, 6400],
    ]);
    expect(learner[0].tokens.map((t) => [t.surface, t.startMs])).toEqual([
      ['كتب', 2000],
      ['الطالب', 2500],
      ['كتابا.', 3000],
    ]);
    expect(learner.flatMap((u) => u.tokens).every((t) => t.lemmaId === null && t.gloss === '')).toBe(true);
    expect(analyze).not.toHaveBeenCalled();
    // Runs once: the button's condition no longer holds.
    expect(app.micTranscriptions.refusal(id)).toMatch(/already transcribed/);
    expect(() => app.micTranscriptions.start(id)).toThrow(/already transcribed/);
  });

  it('puts none of the learner’s words in the Vocabulary, Word Cards, Session Guide or Anki', async () => {
    const recorded = new ManualRecorded();
    const { app, id } = await completedSession(recorded);
    const before = {
      vocabulary: JSON.stringify(app.vocabulary.list()),
      guide: JSON.stringify(app.guides.sessionGuide(id)),
    };
    app.micTranscriptions.start(id);
    await vi.waitFor(() => expect(recorded.given).toHaveLength(1));
    recorded.answer(learnerWords());
    await app.micTranscriptions.idle();
    await app.guides.idle();

    expect(JSON.stringify(app.vocabulary.list())).toBe(before.vocabulary);
    expect(JSON.stringify(app.guides.sessionGuide(id))).toBe(before.guide);
    const katab = app.vocabulary.list().find((e) => e.lemma === 'كتب')!;
    for (const sections of [app.guides.wordCard(katab.lemmaId)!.sections, (await app.words.details(katab.lemmaId))!.sections]) {
      expect(JSON.stringify(sections)).not.toContain('كتابا');
      expect(JSON.stringify(sections)).not.toContain('شكرا');
    }
    expect(await app.anki.export({ kind: 'vocabulary' }, join(dir, 'all.apkg'))).toBe(3);
    expect(await app.anki.export({ kind: 'session', sessionId: id }, join(dir, 's.apkg'))).toBe(3);
  });

  it('says why it failed, stores nothing, and can be tried again', async () => {
    const recorded = new ManualRecorded();
    const { app, id, statuses } = await completedSession(recorded);
    app.micTranscriptions.start(id);
    await vi.waitFor(() => expect(recorded.given).toHaveLength(1));
    recorded.fail('Soniox says the account is out of balance.');
    await app.micTranscriptions.idle();

    expect(statuses.at(-1)).toEqual({ state: 'failed', message: 'Soniox says the account is out of balance.' });
    expect(app.micTranscriptions.status(id)).toEqual(statuses.at(-1));
    expect(app.sessions.transcript(id).some((u) => u.track === 'mic')).toBe(false);
    expect(app.micTranscriptions.refusal(id)).toBeUndefined();

    app.micTranscriptions.start(id);
    // A new try forgets the old failure.
    expect(app.micTranscriptions.status(id)).toMatchObject({ state: 'running' });
    await vi.waitFor(() => expect(recorded.given).toHaveLength(2));
    recorded.answer(learnerWords());
    await app.micTranscriptions.idle();
    expect(app.sessions.transcript(id).filter((u) => u.track === 'mic')).toHaveLength(2);
  });

  it('fails saying so when there is no speech-to-text for recordings', async () => {
    const { app, id } = await completedSession(undefined);
    app.micTranscriptions.start(id);
    await app.micTranscriptions.idle();
    expect(app.micTranscriptions.status(id)).toMatchObject({ state: 'failed' });
  });

  it('keeps Learner Utterances untranslated when translation fails', async () => {
    const recorded = new ManualRecorded();
    const failing: Translator = { translate: async () => Promise.reject(new Error('No key')) };
    const { app, id } = await completedSession(recorded, { translator: failing });
    app.micTranscriptions.start(id);
    await vi.waitFor(() => expect(recorded.given).toHaveLength(1));
    recorded.answer(learnerWords());
    await app.micTranscriptions.idle();
    expect(app.sessions.transcript(id).filter((u) => u.track === 'mic').map((u) => u.translation)).toEqual(['', '']);
  });

  it('with the mic threshold, sends the gated WAV copy instead, and removes it afterwards', async () => {
    const recorded = new ManualRecorded();
    const { app, id } = await completedSession(recorded);
    app.micTranscriptions.beginGatedAudio(id);
    app.micTranscriptions.appendGatedAudio(id, new Uint8Array([0x52, 0x49]));
    app.micTranscriptions.appendGatedAudio(id, new Uint8Array([0x46, 0x46]));
    app.micTranscriptions.start(id, { gated: true });
    await vi.waitFor(() => expect(recorded.given).toHaveLength(1));

    expect(recorded.given[0]).toMatchObject({ contentType: 'audio/wav', bytes: [0x52, 0x49, 0x46, 0x46] });
    const gatedPath = recorded.given[0].path;
    recorded.answer(learnerWords());
    await app.micTranscriptions.idle();
    expect(existsSync(gatedPath)).toBe(false);
    // The Mic Track itself is untouched.
    expect([...readFileSync(app.sessions.micTrackPath(id)!)]).toEqual([7, 8, 9]);
  });

  it('refuses a Session without a Mic Track, one recording, or a gated start with nothing sent', async () => {
    const { app, id } = await completedSession(new ManualRecorded(), { mic: false });
    expect(app.micTranscriptions.refusal(id)).toMatch(/no recorded microphone/);
    expect(() => app.micTranscriptions.start(id)).toThrow(/no recorded microphone/);
    expect(app.micTranscriptions.refusal(999)).toMatch(/no such Session/);

    const live = app.sessions.start('webm', { mic: true });
    expect(app.micTranscriptions.refusal(live.id)).toMatch(/still recording/);
    app.sessions.appendMicAudio(live.id, new Uint8Array([1]));
    await app.sessions.stop(live.id);
    expect(() => app.micTranscriptions.start(live.id, { gated: true })).toThrow(/gated audio/);
  });
});

/** A fake HTTP service: each request is answered by the first route that matches it. */
function fakeServer(routes: Array<[RegExp, (init: RequestInit) => Response]>) {
  const requests: Array<{ method: string; url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    requests.push({ method, url, init });
    const route = routes.find(([pattern]) => pattern.test(`${method} ${url}`));
    if (!route) return new Response('not found', { status: 404 });
    return route[1](init);
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Recorded speech-to-text adapters', () => {
  let file: RecordedAudio;
  beforeEach(() => {
    file = { path: join(dir, 'mic.webm'), contentType: 'audio/webm' };
    writeFileSync(file.path, new Uint8Array([1, 2, 3]));
  });

  it('Soniox: uploads, transcribes with stt-async-v6 in Arabic, polls, reads the transcript, then deletes both', async () => {
    const { SonioxRecordedSpeechToText } = await import('../src/core/stt/recorded');
    let polls = 0;
    const { fetchImpl, requests } = fakeServer([
      [/^POST .*\/v1\/files$/, () => json({ id: 'file-1' }, 201)],
      [/^POST .*\/v1\/transcriptions$/, () => json({ id: 'tx-1', status: 'queued' }, 201)],
      [/^GET .*\/v1\/transcriptions\/tx-1$/, () => json({ id: 'tx-1', status: ++polls < 2 ? 'processing' : 'completed' })],
      [
        /^GET .*\/v1\/transcriptions\/tx-1\/transcript$/,
        () =>
          json({
            tokens: [
              { text: 'كت', start_ms: 100, end_ms: 200 },
              { text: 'ب', start_ms: 200, end_ms: 300 },
              { text: ' الطالب', start_ms: 400, end_ms: 800 },
            ],
          }),
      ],
      [/^DELETE /, () => new Response(null, { status: 204 })],
    ]);
    const stt = new SonioxRecordedSpeechToText({ apiKey: 'sk', fetch: fetchImpl, pollMs: 1 });

    expect(await stt.transcribeFile(file)).toEqual([
      { text: 'كتب', startMs: 100, endMs: 300 },
      { text: 'الطالب', startMs: 400, endMs: 800 },
    ]);
    const upload = requests[0].init.body as FormData;
    expect((upload.get('file') as Blob).size).toBe(3);
    expect(JSON.parse(requests[1].init.body as string)).toEqual({
      model: 'stt-async-v6',
      file_id: 'file-1',
      language_hints: ['ar'],
      language_hints_strict: true,
    });
    expect((requests[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk');
    expect(requests.slice(-2).map((r) => `${r.method} ${r.url.replace(/^.*\/v1/, '')}`)).toEqual([
      'DELETE /transcriptions/tx-1',
      'DELETE /files/file-1',
    ]);
  });

  it('Soniox: a failed transcription says why, and still deletes what it made', async () => {
    const { SonioxRecordedSpeechToText } = await import('../src/core/stt/recorded');
    const { fetchImpl, requests } = fakeServer([
      [/^POST .*\/v1\/files$/, () => json({ id: 'file-1' }, 201)],
      [/^POST .*\/v1\/transcriptions$/, () => json({ id: 'tx-1', status: 'error', error_message: 'Audio is too long' }, 201)],
      [/^DELETE /, () => new Response(null, { status: 204 })],
    ]);
    const stt = new SonioxRecordedSpeechToText({ apiKey: 'sk', fetch: fetchImpl, pollMs: 1 });
    await expect(stt.transcribeFile(file)).rejects.toThrow(/Audio is too long/);
    expect(requests.filter((r) => r.method === 'DELETE')).toHaveLength(2);
  });

  it('Soniox: a refused key says to check it', async () => {
    const { SonioxRecordedSpeechToText } = await import('../src/core/stt/recorded');
    const { fetchImpl } = fakeServer([[/^POST .*\/v1\/files$/, () => json({ message: 'Invalid API key' }, 401)]]);
    const stt = new SonioxRecordedSpeechToText({ apiKey: 'sk', fetch: fetchImpl, pollMs: 1 });
    await expect(stt.transcribeFile(file)).rejects.toThrow(/refused the API key/);
  });

  it('Deepgram: one request with nova-3 in Arabic; words in ms; a 504 is a failure', async () => {
    const { DeepgramRecordedSpeechToText } = await import('../src/core/stt/recorded');
    let status = 200;
    const { fetchImpl, requests } = fakeServer([
      [
        /^POST https:\/\/api\.deepgram\.com\/v1\/listen\?/,
        () =>
          status === 504
            ? new Response('timeout', { status: 504 })
            : json({
                results: {
                  channels: [{ alternatives: [{ words: [{ word: 'كتب', punctuated_word: 'كتب.', start: 1.25, end: 1.5 }] }] }],
                },
              }),
      ],
    ]);
    const stt = new DeepgramRecordedSpeechToText({ apiKey: 'dg', fetch: fetchImpl });
    expect(await stt.transcribeFile(file)).toEqual([{ text: 'كتب.', startMs: 1250, endMs: 1500 }]);
    const url = new URL(requests[0].url);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ model: 'nova-3', language: 'ar' });
    expect(requests[0].init.headers).toMatchObject({ Authorization: 'Token dg', 'Content-Type': 'audio/webm' });

    status = 504;
    await expect(stt.transcribeFile(file)).rejects.toThrow(/10 minutes/);
  });

  it('segments words at sentence ends and pauses of a second or more', async () => {
    const { segmentWords } = await import('../src/core/stt/recorded');
    const events = segmentWords([
      { text: 'a', startMs: 0, endMs: 100 },
      { text: 'b?', startMs: 200, endMs: 300 },
      { text: 'c', startMs: 400, endMs: 500 },
      { text: 'd', startMs: 1500, endMs: 1600 },
    ]);
    expect(events.map((e) => [e.text, e.startMs, e.endMs])).toEqual([
      ['a b?', 0, 300],
      ['c', 400, 500],
      ['d', 1500, 1600],
    ]);
    expect(segmentWords([])).toEqual([]);
  });

  it('keyed: Soniox first, Deepgram as the fallback, else fails saying to add a key', async () => {
    const used: string[] = [];
    const make = {
      soniox: () => ({ transcribeFile: async () => (used.push('soniox'), []) }),
      deepgram: () => ({ transcribeFile: async () => (used.push('deepgram'), []) }),
    };
    const keys = new Map<string, string>();
    const keyed = new KeyedRecordedSpeechToText({ get: (n) => keys.get(n) }, make);
    await expect(keyed.transcribeFile(file)).rejects.toThrow(NO_RECORDING_TRANSCRIPTION_KEY);
    keys.set('deepgram', 'dg');
    await keyed.transcribeFile(file);
    keys.set('soniox', 'sk');
    await keyed.transcribeFile(file);
    expect(used).toEqual(['deepgram', 'soniox']);
  });
});
