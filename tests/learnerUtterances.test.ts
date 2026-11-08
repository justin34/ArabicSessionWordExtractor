import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ankiNote } from '../src/core/anki/notes';
import { createApp, type App } from '../src/core/app';
import { FakeArabicAnalyzer, FakeDictionary, FakeTranslator } from '../src/core/fakes';
import type { SpeechToText, SttEvent } from '../src/core/providers';
import { Store } from '../src/core/store';
import type { LiveUtterance, Track } from '../src/core/types';

/**
 * Learner Utterances (GLOSSARY; ADR 0004): with "Also transcribe my speech", the Mic Track
 * gets its own speech-to-text stream. What the learner says is stored and translated, but
 * never analyzed, so none of it reaches the Vocabulary or any study material.
 */

function final(text: string, startMs: number): SttEvent {
  const words = text.split(' ').map((w, i) => ({ text: w, startMs: startMs + i * 500, endMs: startMs + i * 500 + 400 }));
  return { type: 'final', text, startMs, endMs: startMs + words.length * 500, words };
}

/**
 * One scripted stream per transcribe() call, in the order the streams are opened: the
 * Desktop Track's first, then the Mic Track's. A script that is an Error fails its stream
 * once its audio ends; `received` keeps each stream's audio.
 */
class ScriptedStreams implements SpeechToText {
  received: number[][] = [];
  constructor(private readonly scripts: Array<SttEvent[] | Error>) {}

  async *transcribe(audio: AsyncIterable<Uint8Array>): AsyncIterable<SttEvent> {
    const n = this.received.length;
    const got: number[] = [];
    this.received.push(got);
    const script = this.scripts[n] ?? [];
    if (script instanceof Error) throw script;
    for await (const chunk of audio) got.push(...chunk);
    yield* script;
  }
}

/** The teacher says الطالب كتب الدرس; the learner says كتب الطالب كتابا (كتابا only the learner says). */
const TEACHER = 'كتب الطالب الدرس';
const LEARNER = 'كتب الطالب كتابا';

let dir: string;
let app: App | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ill-learner-'));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  app?.close();
  app = undefined;
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function open(stt: SpeechToText) {
  const analyzer = new FakeArabicAnalyzer();
  const analyze = vi.spyOn(analyzer, 'analyze');
  app = createApp({
    dataDir: dir,
    providers: {
      speechToText: stt,
      translator: new FakeTranslator({ [TEACHER]: 'The student wrote the lesson.', [LEARNER]: 'The student wrote a book.' }),
      arabicAnalyzer: analyzer,
      dictionary: new FakeDictionary({ 'كتب': ['to write'] }),
    },
  });
  const updates: LiveUtterance[] = [];
  const failures: Array<[string, Track]> = [];
  app.sessions.subscribe((_id, u) => updates.push(u));
  app.sessions.subscribeTranscriptionFailures((_id, message, track) => failures.push([message, track]));
  return { app, analyze, updates, failures };
}

async function recordBoth(stt: SpeechToText) {
  const opened = open(stt);
  const { id } = opened.app.sessions.start('webm', { mic: true, transcribeMic: true });
  opened.app.sessions.appendDesktopAudio(id, new Uint8Array([1, 2]));
  opened.app.sessions.appendMicAudio(id, new Uint8Array([7, 8]));
  const session = await opened.app.sessions.stop(id);
  await opened.app.guides.idle();
  return { ...opened, id, session };
}

describe('Learner Utterances', () => {
  it('come from a second stream fed only the Mic Track, stored with their Track and translated', async () => {
    const stt = new ScriptedStreams([[final(TEACHER, 0)], [final(LEARNER, 1000)]]);
    const { app, id } = await recordBoth(stt);

    // Two streams, never one mixed one: each hears only its own Track.
    expect(stt.received).toEqual([
      [1, 2],
      [7, 8],
    ]);
    const transcript = app.sessions.transcript(id);
    expect(transcript.map((u) => [u.track, u.text, u.translation])).toEqual([
      ['desktop', TEACHER, 'The student wrote the lesson.'],
      ['mic', LEARNER, 'The student wrote a book.'],
    ]);
    // Never analyzed: no Lemma, no gloss.
    const learner = transcript[1];
    expect(learner.tokens.map((t) => t.surface)).toEqual(['كتب', 'الطالب', 'كتابا']);
    expect(learner.tokens.every((t) => t.lemmaId === null && t.gloss === '')).toBe(true);
    expect(transcript[0].tokens.every((t) => t.lemmaId !== null)).toBe(true);
  });

  it('are never analyzed, and are sent to Live View marked as the Mic Track with their start', async () => {
    const stt = new ScriptedStreams([
      [final(TEACHER, 0)],
      [{ type: 'interim', text: 'كتب', startMs: 1000, endMs: 1400 }, final(LEARNER, 1000)],
    ]);
    const { analyze, updates } = await recordBoth(stt);

    expect(analyze.mock.calls.map(([sentence]) => sentence)).toEqual([TEACHER]);
    const learner = updates.filter((u) => u.track === 'mic');
    expect(learner.map((u) => [u.id, u.isFinal, u.startMs])).toEqual([
      ['mic-0', false, 1000],
      ['mic-0', true, 1000],
      ['mic-0', true, 1000],
    ]);
    expect(learner.at(-1)).toMatchObject({ translation: 'The student wrote a book.' });
    expect(learner.at(-1)!.tokens.every((t) => t.gloss === '' && t.lemmaId === null)).toBe(true);
    // The teacher's updates are as before, with their start for interleaving.
    expect(updates.filter((u) => u.track === undefined).every((u) => u.id === '0' && u.startMs === 0)).toBe(true);
  });

  it('feed none of the study material: Vocabulary, Word Cards, Session Guide, word panel or Anki', async () => {
    const { app, id } = await recordBoth(new ScriptedStreams([[final(TEACHER, 0)], [final(LEARNER, 1000)]]));

    // Vocabulary: كتابا never enters it; كتب and الطالب count the teacher's occurrence only.
    const vocabulary = app.vocabulary.list();
    expect(vocabulary.map((e) => e.lemma).sort()).toEqual(['الدرس', 'الطالب', 'كتب'].sort());
    for (const entry of vocabulary) {
      expect(entry.count).toBe(1);
      expect(entry.surfaceForms).toEqual([entry.lemma]);
      expect(entry.heardIn).toHaveLength(1);
    }
    const katab = vocabulary.find((e) => e.lemma === 'كتب')!;

    // Word Card and word panel: own-examples and sessions show only the teacher's sentence.
    const sections = [app.guides.wordCard(katab.lemmaId)!.sections, (await app.words.details(katab.lemmaId))!.sections];
    for (const card of sections) {
      expect(JSON.stringify(card)).not.toContain(LEARNER);
      expect(JSON.stringify(card)).not.toContain('كتابا');
      const own = card.find((s) => s.moduleId === 'own-examples');
      expect(JSON.stringify(own)).toContain(TEACHER);
      const heardIn = card.find((s) => s.moduleId === 'sessions')!.blocks[0];
      expect(heardIn).toMatchObject({ kind: 'list', items: [{ note: 'heard once' }] });
    }

    // Session Guide: only the teacher's new words.
    const guide = app.guides.sessionGuide(id)!;
    expect(guide.lemmasHeard).toBe(3);
    expect(guide.groups.flatMap((g) => g.words.map((w) => w.lemma)).sort()).toEqual(['الدرس', 'الطالب', 'كتب'].sort());

    // Anki: as many notes as the teacher's Lemmas, and the Session's export the same.
    expect(await app.anki.export({ kind: 'vocabulary' }, join(dir, 'all.apkg'))).toBe(3);
    expect(await app.anki.export({ kind: 'session', sessionId: id }, join(dir, 'session.apkg'))).toBe(3);
  });

  it('are not transcribed unless asked for: the Mic Track alone opens no second stream', async () => {
    const stt = new ScriptedStreams([[final(TEACHER, 0)], [final(LEARNER, 1000)]]);
    const { app } = open(stt);
    const { id } = app.sessions.start('webm', { mic: true });
    app.sessions.appendMicAudio(id, new Uint8Array([7]));
    await app.sessions.stop(id);

    expect(stt.received).toHaveLength(1);
    expect(app.sessions.transcript(id).map((u) => u.track)).toEqual(['desktop']);
    expect(() => app.sessions.start('webm', { transcribeMic: true })).toThrow(/microphone/);
  });

  it('stop alone when the mic stream fails: the teacher is still transcribed and both Tracks keep every chunk', async () => {
    const stt = new ScriptedStreams([[final(TEACHER, 0)], new Error('Soniox error 503')]);
    const { app, failures } = open(stt);
    const { id } = app.sessions.start('webm', { mic: true, transcribeMic: true });
    await vi.waitFor(() => expect(failures).toHaveLength(1));

    expect(failures).toEqual([['Soniox error 503', 'mic']]);
    expect(app.sessions.transcriptionFailure(id, 'mic')).toBe('Soniox error 503');
    expect(app.sessions.transcriptionFailure(id)).toBeUndefined();
    app.sessions.appendDesktopAudio(id, new Uint8Array([1]));
    app.sessions.appendMicAudio(id, new Uint8Array([7, 8]));
    app.sessions.appendDesktopAudio(id, new Uint8Array([2]));
    const done = await app.sessions.stop(id);

    expect(stt.received[0]).toEqual([1, 2]);
    expect([...readFileSync(done.desktopTrackPath)]).toEqual([1, 2]);
    expect([...readFileSync(done.micTrackPath!)]).toEqual([7, 8]);
    expect(app.sessions.transcript(id).map((u) => [u.track, u.text])).toEqual([['desktop', TEACHER]]);
    expect(app.vocabulary.list()).toHaveLength(3);
  });
});

describe('Stored Utterances and their Track', () => {
  it('are all the Desktop Track in a database from before Learner Utterances', () => {
    const path = join(dir, 'app.db');
    const db = new DatabaseSync(path);
    db.exec(`CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL,
      ended_at TEXT, status TEXT NOT NULL, desktop_track_path TEXT NOT NULL);
      CREATE TABLE utterances (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL,
      text TEXT NOT NULL, translation TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL);
      INSERT INTO sessions (started_at, ended_at, status, desktop_track_path)
      VALUES ('2026-01-01T10:00:00.000Z', '2026-01-01T10:05:00.000Z', 'completed', 'old.webm');
      INSERT INTO utterances (session_id, text, translation, start_ms, end_ms) VALUES (1, 'مرحبا', 'Hello', 0, 500);`);
    db.close();
    const store = new Store(path);
    try {
      expect(store.getTranscript(1).map((u) => u.track)).toEqual(['desktop']);
    } finally {
      store.close();
    }
  });

  it('refuse a Learner Utterance into the Vocabulary, and every reader of study material skips one', async () => {
    const store = new Store(join(dir, 'app.db'));
    try {
      const { id: sessionId } = store.createSession('2026-01-01T10:00:00.000Z', () => 'd.webm', () => 'm.webm');
      const token = (surface: string) => ({ surface, startMs: 0, endMs: 400, gloss: '', lemmaId: null });
      const teacher = store.addUtterance({ sessionId, text: 'كتب', translation: 'He wrote.', startMs: 0, endMs: 500, tokens: [token('كتب')], track: 'desktop' });
      const learner = store.addUtterance({ sessionId, text: 'كتب', translation: 'I wrote.', startMs: 1000, endMs: 1500, tokens: [token('كتب')], track: 'mic' });
      const word = { surface: 'كتب', analysis: { surface: 'كتب', lemma: 'كَتَب' }, tokenPosition: 0 };

      expect(() => store.recordHeardWords(learner, '2026-01-01T10:00:01.000Z', [word])).toThrow(/Learner Utterance/);
      const [lemmaId] = store.recordHeardWords(teacher, '2026-01-01T10:00:00.000Z', [word]);
      expect(store.getTranscript(sessionId)[1].tokens[0].lemmaId).toBeNull();

      // Were a Learner Utterance's word ever stored as heard, no reader would count it.
      const db = new DatabaseSync(join(dir, 'app.db'));
      db.prepare('INSERT INTO occurrences (lemma_id, utterance_id, position, surface) VALUES (?, ?, 0, ?)').run(lemmaId, learner, 'كتب');
      db.close();
      expect(store.listVocabulary()[0]).toMatchObject({ count: 1, heardIn: [{ sessionId, utteranceId: teacher }] });
      expect(store.getLemma(lemmaId)!.count).toBe(1);
      expect(store.lemmaUtterances(lemmaId, 5).map((u) => u.translation)).toEqual(['He wrote.']);
      expect(store.lemmaSessions(lemmaId)).toEqual([{ sessionId, startedAt: '2026-01-01T10:00:00.000Z', count: 1 }]);
      expect(store.sessionLemmaIds(sessionId)).toEqual([lemmaId]);
      expect(store.newLemmasInSession(sessionId).map((l) => l.count)).toEqual([1]);
      const note = await ankiNote(store, new FakeDictionary({}), lemmaId);
      expect(note?.fields.MyExampleTranslation).toBe('He wrote.');
    } finally {
      store.close();
    }
  });
});
