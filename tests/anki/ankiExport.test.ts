import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inflateRawSync } from 'node:zlib';
import { createApp, type App, type AppOptions } from '../../src/core/app';
import { localDate } from '../../src/core/anki/notes';
import { DECK_ID, DECK_NAME, FIELDS, FONT_FILE, NOTE_TYPE_ID, NOTE_TYPE_NAME, noteGuid } from '../../src/core/anki/package';
import { crc32 } from '../../src/core/anki/zip';
import { FakeDictionary, FakeSpeechToText, FakeTranslator } from '../../src/core/fakes';
import type { ArabicAnalyzer, Providers, SttEvent, TokenAnalysis } from '../../src/core/providers';

function final(text: string): SttEvent {
  const words = text.split(' ').map((w, i) => ({ text: w, startMs: i * 500, endMs: i * 500 + 400 }));
  return { type: 'final', text, startMs: 0, endMs: words.length * 500, words };
}

/** Session 1 hears كتبوا الدرس (and a foreign word); Session 2 hears كتب الطالب. */
const first = [final('كتبوا الدرس OK')];
const second = [final('كتب الطالب')];

const analyses: Record<string, TokenAnalysis[]> = {
  'كتبوا الدرس OK': [
    {
      surface: 'كتبوا',
      lemma: 'كَتَب',
      diacritized: 'كَتَبُوا',
      root: 'ك.ت.ب',
      pattern: '1َ2َ3',
      partOfSpeech: 'verb',
      pronunciation: 'k a t a b uu',
      stemGloss: 'write',
    },
    { surface: 'الدرس', lemma: 'دَرْس', diacritized: 'الدَّرْسَ', root: 'د.ر.س', partOfSpeech: 'noun', stemGloss: 'lesson' },
    { surface: 'OK', lemma: 'OK' },
  ],
  'كتب الطالب': [
    { surface: 'كتب', lemma: 'كَتَب', diacritized: 'كَتَبَ', root: 'ك.ت.ب', partOfSpeech: 'verb', pronunciation: 'k a t a b a' },
    { surface: 'الطالب', lemma: 'طالِب', root: 'ط.ل.ب', partOfSpeech: 'noun_prop', stemGloss: 'Talib' },
  ],
};

const analyzer: ArabicAnalyzer = { analyze: async (sentence) => analyses[sentence] ?? [] };

const dictionary = new FakeDictionary({ 'كَتَب': ['to write', 'to compose <letters>'] }, [
  { arabic: 'كتب الرسالة الطويلة.', english: 'He wrote the long letter.' },
  { arabic: 'هل كتبوا؟', english: 'Did they write?' },
]);

function providers(script: SttEvent[], overrides: Partial<Providers> = {}): Providers {
  return {
    speechToText: new FakeSpeechToText(script),
    translator: new FakeTranslator({ 'كتبوا الدرس OK': 'They wrote the lesson, OK.', 'كتب الطالب': 'Talib wrote.' }),
    arabicAnalyzer: analyzer,
    dictionary,
    ...overrides,
  };
}

let dir: string;
let out: string;
let app: App | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ill-anki-'));
  out = join(dir, 'out');
  mkdirSync(out);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  app?.close();
  app = undefined;
  rmSync(dir, { recursive: true, force: true });
});

/** Records each scripted Session in turn, at the times given. */
async function recorded(sessions: Array<{ script: SttEvent[]; at: string }>, options: Partial<AppOptions> = {}) {
  vi.useFakeTimers({ toFake: ['Date'] });
  const audio = join(dir, 'class.webm');
  writeFileSync(audio, Buffer.from([1]));
  for (const { script, at } of sessions) {
    vi.setSystemTime(new Date(at));
    app?.close();
    app = createApp({ dataDir: join(dir, 'data'), ...options, providers: providers(script) });
    await app.sessions.processRecording(audio);
    await app.guides.idle();
  }
  return app!;
}

/** The entries of a zip archive, checked against their CRC. */
function unzip(bytes: Buffer): Map<string, Buffer> {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(bytes.readUInt32LE(at)).toBe(0x02014b50);
    const crc = bytes.readUInt32LE(at + 16);
    const size = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extra = bytes.readUInt16LE(at + 30);
    const comment = bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const dataStart = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = inflateRawSync(bytes.subarray(dataStart, dataStart + size));
    expect(crc32(data)).toBe(crc);
    entries.set(name, data);
    at += 46 + nameLength + extra + comment;
  }
  return entries;
}

interface NoteRow {
  id: number;
  guid: string;
  mid: number;
  mod: number;
  tags: string;
  flds: string;
  sfld: string;
}

/** The package's files, and its collection opened read-only. */
function openPackage(path: string) {
  const files = unzip(readFileSync(path));
  const dbPath = join(dir, `collection-${Math.random()}.anki2`);
  writeFileSync(dbPath, files.get('collection.anki2')!);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const col = db.prepare('SELECT * FROM col').get() as { ver: number; models: string; decks: string };
  const notes = (db.prepare('SELECT * FROM notes ORDER BY id').all() as unknown as NoteRow[]).map((n) => ({
    ...n,
    fields: Object.fromEntries(n.flds.split('\x1f').map((v, i) => [FIELDS[i], v])) as Record<string, string>,
  }));
  const cards = db.prepare('SELECT nid, did, ord, type, queue FROM cards').all() as Array<Record<string, number>>;
  db.close();
  const note = (lemma: string) => notes.find((n) => n.fields.Lemma === lemma)!;
  return {
    files,
    ver: col.ver,
    models: JSON.parse(col.models) as Record<string, any>,
    decks: JSON.parse(col.decks) as Record<string, { name: string }>,
    media: JSON.parse(files.get('media')!.toString('utf8')) as Record<string, string>,
    notes,
    cards,
    note,
  };
}

const SESSION_1 = '2026-11-01T09:00:00.000Z';
const SESSION_2 = '2026-11-03T09:00:00.000Z';

describe('Exporting the Vocabulary to Anki', () => {
  it('writes every Lemma as a note of the note type, into the deck, one recognition card each', async () => {
    const app = await recorded([{ script: first, at: SESSION_1 }]);
    const path = join(out, 'deck.apkg');

    expect(await app.anki.export({ kind: 'vocabulary' }, path)).toBe(2);

    const pkg = openPackage(path);
    expect(pkg.ver).toBe(11);
    const model = pkg.models[NOTE_TYPE_ID];
    expect(model.name).toBe(NOTE_TYPE_NAME);
    expect(model.flds.map((f: { name: string }) => f.name)).toEqual([...FIELDS]);
    expect(model.sortf).toBe(0);
    expect(model.flds[0].rtl).toBe(true);
    expect(model.tmpls).toHaveLength(1);
    expect(pkg.decks[DECK_ID].name).toBe(DECK_NAME);
    // Foreign words are never in the Vocabulary, so never exported.
    expect(pkg.notes.map((n) => n.fields.Lemma).sort()).toEqual(['دَرْس', 'كَتَب'].sort());
    expect(pkg.notes.every((n) => n.mid === NOTE_TYPE_ID)).toBe(true);
    expect(pkg.cards).toHaveLength(2);
    expect(pkg.cards.every((c) => c.did === DECK_ID && c.ord === 0 && c.type === 0 && c.queue === 0)).toBe(true);
  });

  it('fills the fixed fields from the analysis, the dictionary and the learner’s own Sessions', async () => {
    const app = await recorded([
      { script: first, at: SESSION_1 },
      { script: second, at: SESSION_2 },
    ]);
    const path = join(out, 'deck.apkg');
    await app.anki.export({ kind: 'vocabulary' }, path);

    const katab = openPackage(path).note('كَتَب');
    expect(katab.fields).toEqual({
      Lemma: 'كَتَب',
      Gloss: 'to write',
      Definitions: '<ol><li>to write</li><li>to compose &lt;letters&gt;</li></ol>',
      PartOfSpeech: 'verb',
      Root: 'ك.ت.ب',
      Pattern: '1َ2َ3',
      // The form heard spelled as the Lemma (كَتَبَ), not كَتَبُوا.
      Pronunciation: 'k a t a b a',
      FormsHeard: 'كتبوا، كتب',
      // The most recent Utterance, with the word marked.
      MyExample: '<span class="hl">كتب</span> الطالب',
      MyExampleTranslation: 'Talib wrote.',
      // The shortest Tatoeba sentence.
      Example: 'هل <span class="hl">كتبوا</span>؟',
      ExampleTranslation: 'Did they write?',
    });
    expect(katab.sfld).toBe('كَتَب');
  });

  it('tags each note with its part of speech and the date of the Session it was first heard in', async () => {
    const app = await recorded([
      { script: first, at: SESSION_1 },
      { script: second, at: SESSION_2 },
    ]);
    const path = join(out, 'deck.apkg');
    await app.anki.export({ kind: 'vocabulary' }, path);

    const pkg = openPackage(path);
    expect(pkg.note('كَتَب').tags.trim().split(' ')).toEqual(['pos::verb', `session::${localDate(SESSION_1)}`]);
    expect(pkg.note('طالِب').tags.trim().split(' ')).toEqual(['pos::proper_noun', `session::${localDate(SESSION_2)}`]);
  });

  it('shows the Lemma right to left on the front and speaks it with an Arabic voice; the back speaks nothing', async () => {
    const app = await recorded([{ script: first, at: SESSION_1 }]);
    const path = join(out, 'deck.apkg');
    await app.anki.export({ kind: 'vocabulary' }, path);

    const [template] = openPackage(path).models[NOTE_TYPE_ID].tmpls;
    expect(template.qfmt).toContain('dir="rtl"');
    expect(template.qfmt).toContain('{{Lemma}}');
    expect(template.qfmt).toContain('{{tts ar:Lemma}}');
    expect(template.afmt).not.toMatch(/tts|FrontSide|\[sound:/);
    expect(template.afmt).toContain('{{Gloss}}');
  });

  it('packages the Arabic font the cards use, when there is one', async () => {
    const font = join(dir, 'font.woff2');
    writeFileSync(font, Buffer.from('wOF2 font'));
    const app = await recorded([{ script: first, at: SESSION_1 }], { ankiFontPath: font });
    const path = join(out, 'deck.apkg');
    await app.anki.export({ kind: 'vocabulary' }, path);

    const pkg = openPackage(path);
    expect(pkg.media).toEqual({ 0: FONT_FILE });
    expect(pkg.files.get('0')!.toString()).toBe('wOF2 font');
    expect(pkg.models[NOTE_TYPE_ID].css).toContain(FONT_FILE);
  });

  it('suggests a file name with today’s date', async () => {
    const app = await recorded([{ script: first, at: SESSION_1 }]);
    vi.setSystemTime(new Date(2026, 10, 7, 12));
    expect(app.anki.defaultFileName({ kind: 'vocabulary' })).toBe('arabic-vocabulary-2026-11-07.apkg');
  });
});

describe('Re-importing an export', () => {
  // Pinned: Anki matches a re-import by these, so changing any of them duplicates every
  // note the learner imported. They were set once, at the rename (#36).
  it('keeps the note type, deck and GUIDs fixed since the rename to Arabic Session Word Extractor', () => {
    expect(NOTE_TYPE_ID).toBe(1794096000001);
    expect(NOTE_TYPE_NAME).toBe('Arabic Session Word Extractor — Arabic Word');
    expect(DECK_ID).toBe(1794096000002);
    expect(DECK_NAME).toBe('Arabic Session Word Extractor - Vocabulary');
    expect(noteGuid('كَتَب')).toBe('dRFTe2SAx2hkQWdI');
  });

  it('gives each note the same GUID and ids every time, from its Lemma', async () => {
    const app = await recorded([{ script: first, at: SESSION_1 }]);
    await app.anki.export({ kind: 'vocabulary' }, join(out, 'a.apkg'));
    await app.anki.export({ kind: 'vocabulary' }, join(out, 'b.apkg'));

    const a = openPackage(join(out, 'a.apkg'));
    const b = openPackage(join(out, 'b.apkg'));
    expect(a.note('كَتَب').guid).toBe(noteGuid('كَتَب'));
    expect(b.notes.map((n) => [n.guid, n.id])).toEqual(a.notes.map((n) => [n.guid, n.id]));
    expect(new Set(a.notes.map((n) => n.guid)).size).toBe(2);
  });

  it("dates each note by its Word Card's last rebuild, so an unchanged word is not newer next time", async () => {
    const app1 = await recorded([{ script: first, at: SESSION_1 }]);
    await app1.anki.export({ kind: 'vocabulary' }, join(out, 'a.apkg'));
    const before = openPackage(join(out, 'a.apkg'));

    // Session 2 hears كَتَب again, which rebuilds its Word Card; دَرْس is not heard.
    const app2 = await recorded([{ script: second, at: SESSION_2 }]);
    await app2.anki.export({ kind: 'vocabulary' }, join(out, 'b.apkg'));
    const after = openPackage(join(out, 'b.apkg'));

    const darsId = app2.vocabulary.list().find((e) => e.lemma === 'دَرْس')!.lemmaId;
    const darsCard = app2.guides.wordCard(darsId)!;
    expect(after.note('دَرْس').mod).toBe(Math.floor(new Date(darsCard.updatedAt).getTime() / 1000));
    expect(after.note('دَرْس').mod).toBe(before.note('دَرْس').mod);
    expect(after.note('كَتَب').mod).toBeGreaterThan(before.note('كَتَب').mod);
    expect(after.note('كَتَب').mod).toBe(Math.floor(new Date(SESSION_2).getTime() / 1000));
  });
});

describe("Exporting a Session Guide's words to Anki", () => {
  it('exports exactly the Session’s new Lemmas, into the same deck, named by the Session’s date', async () => {
    const app = await recorded([
      { script: first, at: SESSION_1 },
      { script: second, at: SESSION_2 },
    ]);
    const sessionId = app.sessions.list().find((s) => s.startedAt === SESSION_2)!.id;
    const path = join(out, 'session.apkg');

    expect(app.anki.defaultFileName({ kind: 'session', sessionId })).toBe(
      `session-${localDate(SESSION_2)}-new-words.apkg`,
    );
    expect(await app.anki.export({ kind: 'session', sessionId }, path)).toBe(1);

    const pkg = openPackage(path);
    expect(pkg.notes.map((n) => n.fields.Lemma)).toEqual(['طالِب']);
    expect(pkg.decks[DECK_ID].name).toBe(DECK_NAME);
  });

  it('refuses a Session with no new words, writing no file', async () => {
    const app = await recorded([
      { script: second, at: SESSION_1 },
      { script: [final('كتب')], at: SESSION_2 },
    ]);
    const sessionId = app.sessions.list().find((s) => s.startedAt === SESSION_2)!.id;
    const path = join(out, 'session.apkg');

    await expect(app.anki.export({ kind: 'session', sessionId }, path)).rejects.toThrow('This Session has no new words.');
    expect(readdirSync(out)).toEqual([]);
  });
});

describe('Edge cases', () => {
  it('refuses an empty Vocabulary, writing no file', async () => {
    const app = await recorded([{ script: [], at: SESSION_1 }]);
    const path = join(out, 'deck.apkg');

    await expect(app.anki.export({ kind: 'vocabulary' }, path)).rejects.toThrow('Your Vocabulary has no words yet.');
    expect(readdirSync(out)).toEqual([]);
  });

  it('still exports a Lemma whose Word Card is missing or has no sections, dated when first heard', async () => {
    // No Detail Modules: every Word Card has no sections.
    const app = await recorded([{ script: first, at: SESSION_1 }], { detailModules: [] });
    const darsId = app.vocabulary.list().find((e) => e.lemma === 'دَرْس')!.lemmaId;
    const raw = new DatabaseSync(join(dir, 'data', 'app.db'));
    raw.prepare('DELETE FROM word_cards WHERE lemma_id = ?').run(darsId);
    raw.close();
    expect(app.guides.wordCard(darsId)).toBeUndefined();

    const path = join(out, 'deck.apkg');
    expect(await app.anki.export({ kind: 'vocabulary' }, path)).toBe(2);

    const dars = openPackage(path).note('دَرْس');
    expect(dars.fields.Lemma).toBe('دَرْس');
    expect(dars.fields.Gloss).toBe('lesson');
    expect(dars.fields.Definitions).toBe('');
    expect(dars.mod).toBe(Math.floor(new Date(SESSION_1).getTime() / 1000));
  });

  it('exports what it can when the dictionary fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = await recorded([{ script: first, at: SESSION_1 }]);
    vi.spyOn(dictionary, 'lookup').mockRejectedValue(new Error('dictionary gone'));
    vi.spyOn(dictionary, 'examples').mockRejectedValue(new Error('dictionary gone'));
    const path = join(out, 'deck.apkg');

    expect(await app.anki.export({ kind: 'vocabulary' }, path)).toBe(2);
    const katab = openPackage(path).note('كَتَب');
    expect(katab.fields.Gloss).toBe('write');
    expect(katab.fields.Example).toBe('');
    expect(katab.fields.MyExample).toContain('<span class="hl">كتبوا</span>');
  });

  it('says so when the file cannot be written, and leaves no partial file', async () => {
    const app = await recorded([{ script: first, at: SESSION_1 }]);
    // A folder where the file should go: the write cannot replace it.
    const path = join(out, 'deck.apkg');
    mkdirSync(path);

    await expect(app.anki.export({ kind: 'vocabulary' }, path)).rejects.toThrow(/could not be saved/);
    expect(readdirSync(out)).toEqual(['deck.apkg']);
    await expect(app.anki.export({ kind: 'vocabulary' }, join(out, 'missing', 'deck.apkg'))).rejects.toThrow(
      /could not be saved/,
    );
    expect(existsSync(join(out, 'missing'))).toBe(false);
  });

  it('replaces an earlier export of the same name whole', async () => {
    const app = await recorded([{ script: first, at: SESSION_1 }]);
    const path = join(out, 'deck.apkg');
    writeFileSync(path, 'old');

    await app.anki.export({ kind: 'vocabulary' }, path);

    expect(openPackage(path).notes).toHaveLength(2);
    expect(readdirSync(out)).toEqual(['deck.apkg']);
  });
});
