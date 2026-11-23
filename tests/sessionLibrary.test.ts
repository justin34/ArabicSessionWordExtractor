import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ankiNote, localDate } from '../src/core/anki/notes';
import { AnkiExporter } from '../src/core/anki/export';
import { createApp, type App } from '../src/core/app';
import { FakeArabicAnalyzer, FakeDictionary, FakeTranslator } from '../src/core/fakes';
import type { SpeechToText, SttEvent } from '../src/core/providers';
import { Store } from '../src/core/store';

/**
 * Session names and removing a Session (#57, ADR 0005): a completed Session can be named;
 * removing one purges it, or with "Keep its words" leaves a Removed Session.
 */

/** Speech-to-text that says whatever the next Session is set to say. */
class ScriptedSpeech implements SpeechToText {
  next: string[] = [];
  async *transcribe(audio: AsyncIterable<Uint8Array>): AsyncIterable<SttEvent> {
    for await (const _ of audio) void _;
    let at = 0;
    for (const text of this.next) {
      const words = text.split(' ').map((w, i) => ({ text: w, startMs: at + i * 500, endMs: at + i * 500 + 400 }));
      yield { type: 'final', text, startMs: at, endMs: words.at(-1)!.endMs, words };
      at += 5000;
    }
  }
}

let dir: string;
let app: App | undefined;
let speech: ScriptedSpeech;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ill-library-'));
  speech = new ScriptedSpeech();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  app?.close();
  app = undefined;
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function open(): App {
  app = createApp({
    dataDir: dir,
    providers: {
      speechToText: speech,
      translator: new FakeTranslator({ 'كتب درس': 'He wrote a lesson', 'كتب قلم': 'He wrote a pen' }),
      arabicAnalyzer: new FakeArabicAnalyzer(),
      dictionary: new FakeDictionary({ 'قلم': ['pen'] }),
    },
    translationWaitMs: 50,
  });
  return app;
}

/** Records a completed Session that heard `sentences`, with a Mic Track. */
async function record(core: App, ...sentences: string[]) {
  speech.next = sentences;
  const { id } = core.sessions.start('webm', { mic: true });
  core.sessions.appendDesktopAudio(id, new Uint8Array([1, 2, 3]));
  core.sessions.appendMicAudio(id, new Uint8Array([4, 5]));
  const session = await core.sessions.stop(id);
  await core.guides.idle();
  return session;
}

const entry = (core: App, lemma: string) => core.vocabulary.list().find((e) => e.lemma === lemma);
const heardIn = (core: App, lemma: string) =>
  core.guides.wordCard(entry(core, lemma)!.lemmaId)!.sections.find((s) => s.moduleId === 'sessions')!.blocks;

describe('Session names', () => {
  it('names a completed Session, trimmed; clearing it goes back to unnamed; it survives a restart', async () => {
    const core = open();
    const { id } = await record(core, 'كتب درس');
    expect(core.sessions.list()[0].name).toBeNull();

    expect(core.library.rename(id, '  الدرس الرابع  ').name).toBe('الدرس الرابع');
    core.close();
    expect(open().sessions.list()[0].name).toBe('الدرس الرابع');
    expect(app!.library.rename(id, '   ').name).toBeNull();
    expect(app!.library.rename(id, 'Lesson 4').name).toBe('Lesson 4');
    expect(app!.library.rename(id, null).name).toBeNull();
  });

  it('allows up to 100 characters, and duplicates', async () => {
    const core = open();
    const a = await record(core, 'كتب درس');
    const b = await record(core, 'كتب قلم');
    core.library.rename(a.id, 'Lesson');
    expect(core.library.rename(b.id, 'Lesson').name).toBe('Lesson');
    expect(core.library.rename(a.id, 'x'.repeat(100)).name).toHaveLength(100);
    expect(() => core.library.rename(a.id, 'x'.repeat(101))).toThrow(/100 characters/);
  });

  it('renames only completed Sessions', () => {
    const core = open();
    const { id } = core.sessions.start();
    expect(() => core.library.rename(id, 'Live')).toThrow(/Stop the Session/);
  });

  it('names the Session in "Heard in" and "Your examples" once the Word Card is rebuilt', async () => {
    const core = open();
    const { id } = await record(core, 'كتب درس');
    core.library.rename(id, 'Lesson 4');
    await record(core, 'كتب قلم');
    expect(heardIn(core, 'كتب')).toEqual([
      { kind: 'list', items: [expect.objectContaining({ note: 'heard once' }), { text: 'Lesson 4', note: 'heard once' }] },
    ]);
  });

  it("tags Anki notes with the first-heard Session's name, and suggests it as the file name", async () => {
    const core = open();
    const { id, startedAt } = await record(core, 'كتب درس');
    const store = new Store(join(dir, 'app.db'));
    try {
      const exporter = new AnkiExporter(store, new FakeDictionary());
      const lemmaId = entry(core, 'كتب')!.lemmaId;
      const before = (await ankiNote(store, new FakeDictionary(), lemmaId))!;
      expect(before.tags).toContain(`session::${localDate(startedAt)}`);
      expect(exporter.defaultFileName({ kind: 'session', sessionId: id })).toBe(
        `session-${localDate(startedAt)}-new-words.apkg`,
      );

      await new Promise((r) => setTimeout(r, 5));
      core.library.rename(id, 'Lesson 4: a::b / "draft"?');
      const after = (await ankiNote(store, new FakeDictionary(), lemmaId))!;
      expect(after.tags).toContain(`session::${localDate(startedAt)}::Lesson_4:_ab_/_"draft"?`);
      // The rename counts as a change, so re-importing the export retags the note.
      expect(after.modifiedMs).toBeGreaterThan(before.modifiedMs);
      expect(exporter.defaultFileName({ kind: 'session', sessionId: id })).toBe('Lesson 4 ab draft - new words.apkg');
    } finally {
      store.close();
    }
  });
});

describe('Remove a Session, purging it', () => {
  it('lists the words heard only in that Session, with their gloss', async () => {
    const core = open();
    await record(core, 'كتب درس');
    const b = await record(core, 'كتب قلم');
    expect(core.library.removalPreview(b.id).words).toEqual([
      { lemmaId: entry(core, 'قلم')!.lemmaId, lemma: 'قلم', gloss: 'pen', ignored: false },
    ]);
  });

  it('takes back what it added: its words heard nowhere else go, shared ones are recomputed, its files are deleted', async () => {
    const core = open();
    const a = await record(core, 'كتب درس');
    const guideA = core.guides.sessionGuide(a.id);
    const b = await record(core, 'كتب قلم');
    const pen = entry(core, 'قلم')!.lemmaId;
    core.vocabulary.setIgnored(pen, true);
    const wrote = entry(core, 'كتب')!;
    expect(wrote.count).toBe(2);

    core.library.remove(b.id, { keepWords: false });
    await core.guides.idle();

    expect(core.sessions.list().map((s) => s.id)).toEqual([a.id]);
    expect(entry(core, 'قلم')).toBeUndefined();
    expect(core.guides.wordCard(pen)).toBeUndefined();
    expect(entry(core, 'كتب')).toMatchObject({ count: 1, firstHeardAt: wrote.firstHeardAt, heardIn: [{ sessionId: a.id }] });
    expect(existsSync(b.desktopTrackPath)).toBe(false);
    expect(existsSync(b.micTrackPath!)).toBe(false);
    expect(core.guides.sessionGuide(b.id)).toBeUndefined();
    expect(core.guides.sessionGuide(a.id)).toEqual(guideA);
    // Its Word Card is rebuilt: "Heard in" no longer lists the removed Session.
    expect(heardIn(core, 'كتب')).toEqual([{ kind: 'list', items: [expect.objectContaining({ note: 'heard once' })] }]);
  });

  it("moves a shared word's first-heard date to the next Session, without changing that Session's guide", async () => {
    const core = open();
    const a = await record(core, 'كتب درس');
    const b = await record(core, 'كتب قلم');
    const guideB = core.guides.sessionGuide(b.id);
    const inB = core.sessions.transcript(b.id)[0];

    core.library.remove(a.id, { keepWords: false });
    await core.guides.idle();

    const wrote = entry(core, 'كتب')!;
    expect(wrote.count).toBe(1);
    expect(Date.parse(wrote.firstHeardAt)).toBeGreaterThanOrEqual(Date.parse(b.startedAt));
    expect(wrote.surfaceForms).toEqual(['كتب']);
    expect(entry(core, 'درس')).toBeUndefined();
    expect(inB.tokens[0].lemmaId).toBe(wrote.lemmaId);
    expect(core.guides.sessionGuide(b.id)).toEqual(guideB);
  });

  it('is refused for a Session that records', () => {
    const core = open();
    const { id } = core.sessions.start();
    expect(() => core.library.remove(id, { keepWords: false })).toThrow(/Stop the Session/);
  });
});

describe('Remove a Session, keeping its words', () => {
  it('leaves the Vocabulary as it was, and a Removed Session the words say they were first heard in', async () => {
    const core = open();
    const a = await record(core, 'كتب درس');
    core.library.rename(a.id, 'Lesson 4');
    const b = await record(core, 'كتب قلم');
    const guideB = core.guides.sessionGuide(b.id);
    const before = core.vocabulary.list();

    core.library.remove(a.id, { keepWords: true });
    await core.guides.idle();

    expect(core.sessions.list().map((s) => s.id)).toEqual([b.id]);
    expect(core.sessions.transcript(a.id)).toEqual([]);
    expect(existsSync(a.desktopTrackPath)).toBe(false);
    expect(existsSync(a.micTrackPath!)).toBe(false);
    const after = core.vocabulary.list();
    expect(after.map(({ firstHeardInRemoved: _, ...e }) => e)).toEqual(
      before.map(({ firstHeardInRemoved: _, heardIn, ...e }) => ({
        ...e,
        heardIn: heardIn.map((h) => (h.sessionId === a.id ? { ...h, utteranceId: null } : h)),
      })),
    );
    expect(after.find((e) => e.lemma === 'درس')!.firstHeardInRemoved).toBe(true);
    expect(after.find((e) => e.lemma === 'قلم')!.firstHeardInRemoved).toBe(false);
    expect(core.guides.sessionGuide(b.id)).toEqual(guideB);
    expect(heardIn(core, 'كتب')).toEqual([
      { kind: 'list', items: [expect.objectContaining({ note: 'heard once' }), { text: 'Lesson 4 (removed Session)', note: 'heard once' }] },
    ]);
  });

  it("keeps tagging Anki notes with the Removed Session's name and date", async () => {
    const core = open();
    const a = await record(core, 'كتب درس');
    core.library.rename(a.id, 'Lesson 4');
    core.library.remove(a.id, { keepWords: true });
    const store = new Store(join(dir, 'app.db'));
    try {
      const note = await ankiNote(store, new FakeDictionary(), entry(core, 'درس')!.lemmaId);
      expect(note!.tags).toContain(`session::${localDate(a.startedAt)}::Lesson_4`);
      expect(note!.fields.MyExample).toBe('');
    } finally {
      store.close();
    }
  });

  it('cannot be removed again, nor renamed', async () => {
    const core = open();
    const a = await record(core, 'كتب درس');
    core.library.remove(a.id, { keepWords: true });
    expect(() => core.library.remove(a.id, { keepWords: false })).toThrow(/no such Session/);
    expect(() => core.library.rename(a.id, 'x')).toThrow(/no such Session/);
  });
});

describe('Audio files no Session points to', () => {
  it('are deleted when the app opens, e.g. one Windows kept locked', async () => {
    const core = open();
    const a = await record(core, 'كتب درس');
    core.close();
    const left = join(dir, 'recordings', 'session-99-desktop.webm');
    writeFileSync(left, new Uint8Array([1]));
    const other = join(dir, 'recordings', 'notes.txt');
    writeFileSync(other, 'mine');
    open();
    expect(existsSync(left)).toBe(false);
    expect(readFileSync(other, 'utf8')).toBe('mine');
    expect(existsSync(a.desktopTrackPath)).toBe(true);
  });
});

describe('A database from before Removed Sessions', () => {
  it('gives every Occurrence its Session and when it was heard', () => {
    const path = join(dir, 'old.db');
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, ended_at TEXT,
        status TEXT NOT NULL, desktop_track_path TEXT NOT NULL);
      CREATE TABLE utterances (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL REFERENCES sessions(id),
        text TEXT NOT NULL, translation TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL);
      CREATE TABLE lemmas (id INTEGER PRIMARY KEY AUTOINCREMENT, lemma TEXT NOT NULL UNIQUE, root TEXT,
        part_of_speech TEXT, stem_gloss TEXT, first_heard_at TEXT NOT NULL);
      CREATE TABLE occurrences (id INTEGER PRIMARY KEY AUTOINCREMENT, lemma_id INTEGER NOT NULL REFERENCES lemmas(id),
        utterance_id INTEGER NOT NULL REFERENCES utterances(id), position INTEGER NOT NULL, surface TEXT NOT NULL);
      INSERT INTO sessions VALUES (1, '2026-01-01T10:00:00.000Z', '2026-01-01T10:05:00.000Z', 'completed', 'd.webm');
      INSERT INTO utterances VALUES (1, 1, 'كتب', '', 1500, 2000);
      INSERT INTO lemmas VALUES (1, 'كتب', NULL, NULL, NULL, '2026-01-01T10:00:01.500Z');
      INSERT INTO occurrences VALUES (1, 1, 1, 0, 'كتب');
    `);
    db.close();
    const store = new Store(path);
    try {
      expect(store.listVocabulary()[0]).toMatchObject({ count: 1, heardIn: [{ sessionId: 1, utteranceId: 1 }] });
      expect(store.lemmaSessions(1)).toEqual([
        { sessionId: 1, startedAt: '2026-01-01T10:00:00.000Z', name: null, renamedAt: null, removed: false, count: 1 },
      ]);
      expect(store.purgeSession(1).lemmaIds).toEqual([]);
      expect(store.listVocabulary()).toEqual([]);
    } finally {
      store.close();
    }
    const check = new DatabaseSync(path);
    expect(check.prepare('SELECT count(*) AS n FROM occurrences').get()).toEqual({ n: 0 });
    check.close();
  });

  it('backfills when each Occurrence was heard from its Session and Utterance', () => {
    const path = join(dir, 'old2.db');
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, ended_at TEXT,
        status TEXT NOT NULL, desktop_track_path TEXT NOT NULL);
      CREATE TABLE utterances (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL REFERENCES sessions(id),
        text TEXT NOT NULL, translation TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL);
      CREATE TABLE lemmas (id INTEGER PRIMARY KEY AUTOINCREMENT, lemma TEXT NOT NULL UNIQUE, root TEXT,
        part_of_speech TEXT, stem_gloss TEXT, first_heard_at TEXT NOT NULL);
      CREATE TABLE occurrences (id INTEGER PRIMARY KEY AUTOINCREMENT, lemma_id INTEGER NOT NULL REFERENCES lemmas(id),
        utterance_id INTEGER NOT NULL REFERENCES utterances(id), position INTEGER NOT NULL, surface TEXT NOT NULL);
      INSERT INTO sessions VALUES (1, '2026-01-01T10:00:00.000Z', NULL, 'completed', 'd.webm');
      INSERT INTO utterances VALUES (1, 1, 'كتب', '', 1500, 2000);
      INSERT INTO lemmas VALUES (1, 'كتب', NULL, NULL, NULL, '2026-01-01T10:00:01.500Z');
      INSERT INTO occurrences VALUES (1, 1, 1, 0, 'كتب');
    `);
    db.close();
    new Store(path).close();
    const check = new DatabaseSync(path);
    expect(check.prepare('SELECT session_id, heard_at FROM occurrences').get()).toEqual({
      session_id: 1,
      heard_at: '2026-01-01T10:00:01.500Z',
    });
    check.close();
  });
});
