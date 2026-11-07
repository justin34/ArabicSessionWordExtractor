import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  bareKey,
  DictionaryWriter,
  exampleWords,
  tatoebaPairs,
  tatoebaSentence,
  wiktionaryRow,
  type DictionaryRow,
} from '../../src/core/dictionary/data';
import { quickGloss, readableStemGloss, shortGloss } from '../../src/core/dictionary/gloss';
import { headwordKey, SqliteDictionary } from '../../src/core/dictionary/sqlite';

/** A wiktextract entry as the raw dump has it, trimmed to the fields we read. */
const wiktextract = (word: string, pos: string, canonical: string, senses: object[]) => ({
  word,
  lang: 'Arabic',
  lang_code: 'ar',
  pos,
  forms: [
    { form: canonical, tags: ['canonical'] },
    { form: 'kataba', tags: ['romanization'] },
  ],
  senses,
});

describe('Extracting Wiktionary entries', () => {
  it('keeps an Arabic word with its canonical headword, part of speech and senses', () => {
    const row = wiktionaryRow(
      wiktextract('كتب', 'verb', 'كَتَبَ', [
        { glosses: ['to write'] },
        { glosses: ['to write', 'to compose (a book)'] },
      ]),
    );

    expect(row).toEqual({
      word: 'كتب',
      headword: 'كَتَبَ',
      partOfSpeech: 'verb',
      definitions: ['to write', 'to compose (a book)'],
    });
  });

  it('drops senses that only point at another entry, and entries left with none', () => {
    const plural = wiktextract('كتب', 'noun', 'كُتُب', [
      { glosses: ['plural of كِتَاب (kitāb)'], tags: ['form-of', 'plural'] },
    ]);
    const mixed = wiktextract('كتب', 'noun', 'كَتْب', [
      { glosses: ['verbal noun of كَتَبَ'], tags: ['form-of'] },
      { glosses: ['writing'] },
    ]);

    expect(wiktionaryRow(plural)).toBeNull();
    expect(wiktionaryRow(mixed)?.definitions).toEqual(['writing']);
  });

  it("keeps the entry's etymology when Wiktionary gives one", () => {
    const entry = {
      ...wiktextract('كتب', 'verb', 'كَتَبَ', [{ glosses: ['to write'] }]),
      etymology_text: ' From the root ك ت ب (k-t-b). ',
    };

    expect(wiktionaryRow(entry)?.etymology).toBe('From the root ك ت ب (k-t-b).');
    expect(wiktionaryRow({ ...entry, etymology_text: '' })).not.toHaveProperty('etymology');
  });

  it('skips other languages, letters and affixes', () => {
    expect(wiktionaryRow({ ...wiktextract('كتب', 'verb', 'كَتَبَ', [{ glosses: ['x'] }]), lang_code: 'fa' })).toBeNull();
    expect(wiktionaryRow(wiktextract('ب', 'character', 'ب', [{ glosses: ['letter'] }]))).toBeNull();
    expect(wiktionaryRow(wiktextract('ال', 'prefix', 'ال', [{ glosses: ['the'] }]))).toBeNull();
    expect(wiktionaryRow({ title: 'Redirect', redirect: 'x' } as object)).toBeNull();
  });

  it('keys entries by their letters, without diacritics or tatweel', () => {
    expect(bareKey('كَتَبَ')).toBe('كتب');
    expect(bareKey('هٰذَا')).toBe('هذا');
    expect(bareKey('كـتـب')).toBe('كتب');
    expect(bareKey('أَكَلَ')).toBe('أكل');
    expect(bareKey('ٱِسْم')).toBe('اسم');
  });
});

describe('Extracting Tatoeba pairs', () => {
  it('pairs each linked Arabic sentence with its English translation, once', () => {
    const ar = new Map([[1, 'أنا طالب.'], [2, 'شكرا.']]);
    const en = new Map([[10, 'I am a student.'], [11, 'Thanks.'], [12, 'Thank you.']]);

    expect(tatoebaPairs(ar, en, [[2, 12], [1, 10], [2, 11], [1, 10], [3, 10], [1, 99]])).toEqual([
      { arabic: 'أنا طالب.', english: 'I am a student.' },
      { arabic: 'شكرا.', english: 'Thanks.' },
      { arabic: 'شكرا.', english: 'Thank you.' },
    ]);
  });

  it("splits an example into its words' lookup keys", () => {
    expect(exampleWords('كَتَبَ الطالبُ، الطالبُ؟')).toEqual(['كتب', 'الطالب']);
  });

  it('reads a sentences export line', () => {
    expect(tatoebaSentence('42\tara\tمرحبا\n')).toEqual([42, 'مرحبا']);
    expect(tatoebaSentence('oops')).toBeNull();
  });
});

describe('Looking Lemmas up in the built dictionary', () => {
  let dir: string;
  let dictionary: SqliteDictionary | undefined;

  const rows: DictionaryRow[] = [
    { word: 'من', headword: 'مَن', partOfSpeech: 'pron', definitions: ['who'] },
    { word: 'من', headword: 'مِن', partOfSpeech: 'prep', definitions: ['from, of'] },
    { word: 'كتب', headword: 'كُتُب', partOfSpeech: 'noun', definitions: ['books'] },
    { word: 'كتب', headword: 'كَتَبَ', partOfSpeech: 'verb', definitions: ['to write'], etymology: 'From the root ك ت ب.' },
    { word: 'كتاب', headword: 'كِتَاب', partOfSpeech: 'noun', definitions: ['book'] },
    { word: 'علم', headword: 'عَلَم', partOfSpeech: 'noun', definitions: ['flag'] },
    { word: 'علم', headword: 'عِلْم', partOfSpeech: 'noun', definitions: ['knowledge, science'] },
    { word: 'مصر', headword: 'مِصْر', partOfSpeech: 'name', definitions: ['Egypt'] },
    { word: 'اسم', headword: 'اِسْم', partOfSpeech: 'noun', definitions: ['name'] },
  ];

  const examples = [
    { arabic: 'أنا طالب.', english: 'I am a student.' },
    { arabic: 'كَتَبَ الطالبُ رسالةً طويلةً جدًّا.', english: 'The student wrote a very long letter.' },
    { arabic: 'هل كتبتم؟', english: 'Did you write?' },
    { arabic: 'هل كتبتم؟', english: 'Have you written?' },
    { arabic: 'المكتبة كبيرة.', english: 'The library is big.' },
  ];

  function build(): SqliteDictionary {
    const path = join(dir, 'dictionary.db');
    const writer = new DictionaryWriter(path);
    rows.forEach((r) => writer.addEntry(r));
    examples.forEach((e) => writer.addExample(e));
    expect(writer.finish({ source: 'test' })).toEqual({ entries: rows.length, examples: examples.length });
    dictionary = new SqliteDictionary(path);
    return dictionary;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ill-dict-'));
  });

  afterEach(() => {
    dictionary?.close();
    dictionary = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it("picks the entry whose diacritized headword is the analyzer's Lemma", async () => {
    const d = build();

    expect((await d.lookup('مِن', 'prep'))?.definitions).toEqual(['from, of']);
    expect((await d.lookup('مَن', 'pron_rel'))?.definitions).toEqual(['who']);
    // CAMeL spells verbs without their final vowel, and long alef without the fatha before it.
    expect((await d.lookup('كَتَب', 'verb'))?.definitions).toEqual(['to write']);
    expect((await d.lookup('كِتاب', 'noun'))?.definitions).toEqual(['book']);
    expect((await d.lookup('عِلْم', 'noun'))?.definitions).toEqual(['knowledge, science']);
  });

  it('turns down an entry spelled like the Lemma but another part of speech', async () => {
    const d = build();

    // As the interjection نَعَم "yes" is spelled like the verb نَعَمَ "to live in comfort".
    expect(await d.lookup('مِصْر', 'verb')).toBeUndefined();
    // A name is not glossed by a common noun spelled alike.
    expect(await d.lookup('عِلْم', 'noun_prop')).toBeUndefined();
    expect(await d.lookup('مِصْر')).toMatchObject({ definitions: ['Egypt'] });
  });

  it('finds a Lemma the analyzer spells with alef wasla', async () => {
    const d = build();

    expect(await d.lookup('ٱِسْم', 'noun')).toMatchObject({ definitions: ['name'] });
  });

  it('falls back to the one entry with a matching part of speech, and to none when unsure', async () => {
    const d = build();

    expect(await d.lookup('مَصْر', 'noun_prop')).toMatchObject({ headword: 'مِصْر', definitions: ['Egypt'] });
    // Two nouns spelled علم, neither with these diacritics: no guess.
    expect(await d.lookup('عُلَم', 'noun')).toBeUndefined();
    expect(await d.lookup('غَيْر', 'noun')).toBeUndefined();
  });

  it('gives the etymology with the entry', async () => {
    const d = build();

    expect(await d.lookup('كَتَب', 'verb')).toMatchObject({ etymology: 'From the root ك ت ب.' });
    expect(await d.lookup('كِتاب', 'noun')).not.toHaveProperty('etymology');
  });

  it('finds example sentences by whole words, ignoring diacritics and punctuation, shortest first, each once', async () => {
    const d = build();

    expect(await d.examples(['كتبتم', 'الطَّالِب'], 5)).toEqual([
      { arabic: 'هل كتبتم؟', english: 'Did you write?' },
      { arabic: 'كَتَبَ الطالبُ رسالةً طويلةً جدًّا.', english: 'The student wrote a very long letter.' },
    ]);
    // كتب is not a whole word of المكتبة.
    expect(await d.examples(['كَتَبَ'], 5)).toHaveLength(1);
    expect(await d.examples(['كتبتم', 'الطالب'], 1)).toHaveLength(1);
    expect(await d.examples(['غير'], 5)).toEqual([]);
    expect(await d.examples([], 5)).toEqual([]);
  });

  it('refuses a database built with another schema', () => {
    const path = join(dir, 'other.db');
    new DictionaryWriter(path).finish({});
    const db = new DatabaseSync(path);
    db.exec("UPDATE meta SET value = '0' WHERE key = 'schema_version'");
    db.close();

    expect(() => new SqliteDictionary(path)).toThrow(/schema 0/);
  });

  it('reduces diacritized forms to what both sources spell alike', () => {
    expect(headwordKey('كَتَبَ')).toBe(headwordKey('كَتَب'));
    expect(headwordKey('كِتَاب')).toBe(headwordKey('كِتاب'));
    expect(headwordKey('مِن')).not.toBe(headwordKey('مَن'));
  });
});

describe('Quick gloss', () => {
  const entry = (...definitions: string[]) => ({ lemma: 'x', definitions });

  it("takes the dictionary's first sense: its first alternative, or the shortest when that is long", () => {
    expect(
      quickGloss(entry('to mark (symbols, letters) on a surface, to write, to inscribe', 'to x'), 'write', 'verb'),
    ).toBe('to write');
    expect(quickGloss(entry('condition, state, situation, position'), 'situation', 'noun')).toBe('condition');
    expect(shortGloss('(transitive) to study')).toBe('to study');
    expect(shortGloss('book.')).toBe('book');
    expect(shortGloss('she (subject pronoun).')).toBe('she');
    expect(shortGloss('I (first person singular subject pronoun)')).toBe('I');
  });

  it('keeps a verb glossed as a verb', () => {
    // Wiktionary's "(with)" lost its parentheses here; a bare "with" is no gloss for a verb.
    expect(shortGloss('to become acquainted, with, to meet')).toBe('to meet');
  });

  it('prefers the stem gloss for a sense too long to sit under a word', () => {
    expect(quickGloss(entry('any populated area or the community thereof'), 'village', 'noun')).toBe('village');
    expect(quickGloss(entry('any populated area or the community thereof'), undefined, 'noun')).toBe(
      'any populated area or the community thereof',
    );
  });

  it('glosses prepositions, conjunctions and particles by the stem gloss, which translates them', () => {
    expect(quickGloss(entry('having partitive effect: of, some of'), 'from', 'prep')).toBe('from');
    expect(quickGloss(entry('introduces a positive yes-no question'), 'does;do?;did?', 'part_interrog')).toBe('does');
    expect(quickGloss(entry('indicates an inclusive disjunction'), 'or', 'conj')).toBe('or');
    expect(quickGloss(entry('to live in comfort'), 'yes', 'interj')).toBe('yes');
    // With no stem gloss, the dictionary still answers.
    expect(quickGloss(entry('in, within'), undefined, 'prep')).toBe('in');
  });

  it("falls back to the analyzer's stem gloss, made readable", () => {
    expect(quickGloss(undefined, 'make_walk;adjust')).toBe('make walk');
    expect(readableStemGloss('student')).toBe('student');
    expect(readableStemGloss('brother_+_my')).toBe('brother');
    expect(readableStemGloss('you_[masc.sg.]')).toBe('you');
    expect(quickGloss(undefined, 'NO_ANALYSIS')).toBe('');
    expect(quickGloss(undefined, undefined)).toBe('');
  });
});
