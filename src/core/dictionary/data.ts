/**
 * The bundled dictionary database (GLOSSARY, Dictionary plan): its schema, the lookup key,
 * and the extraction of rows from the raw sources. `scripts/build-dictionary.mjs` runs this
 * offline; the app only ever reads the result.
 *
 * Imports node builtins only, so the build script can load this file with Node's type
 * stripping.
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';

export const SCHEMA_VERSION = 1;

/** One Arabic dictionary entry: a headword with one part of speech and its senses. */
export interface DictionaryRow {
  /** Lookup key: the headword's letters, without diacritics (see `bareKey`). */
  word: string;
  /** Canonical diacritized headword, e.g. 'كَتَبَ'. */
  headword: string;
  /** Wiktionary part of speech, e.g. 'verb', 'noun', 'name'. */
  partOfSpeech: string;
  /** Glosses of the entry's real senses, in order: no "plural of …" style form-of senses. */
  definitions: string[];
}

/** One Tatoeba sentence pair. */
export interface ExamplePair {
  arabic: string;
  english: string;
}

const TATWEEL = /ـ/g;

/** A word's letters with diacritics and tatweel removed: the key headwords are looked up by. */
export function bareKey(word: string): string {
  // NFC first: hamza and madda stay part of their letter (أ), not a mark to strip.
  return word
    .normalize('NFC')
    .replace(/\p{M}/gu, '')
    .replace(TATWEEL, '')
    .replace(/ٱ/g, 'ا') // alef wasla, as CAMeL writes some Lemmas (ٱِسْم), is a plain alef
    .trim();
}

/** Parts of speech that are not words a learner hears. */
const SKIPPED_POS = new Set([
  'character',
  'symbol',
  'punct',
  'romanization',
  'prefix',
  'suffix',
  'infix',
  'interfix',
  'affix',
  'root',
]);

/** Sense tags that make a sense a pointer to another entry, not a meaning of its own. */
const POINTER_TAGS = new Set(['form-of', 'alt-of', 'no-gloss']);

interface WiktextractSense {
  glosses?: unknown;
  tags?: unknown;
}

interface WiktextractEntry {
  word?: unknown;
  lang_code?: unknown;
  pos?: unknown;
  senses?: unknown;
  forms?: unknown;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * The dictionary row for one wiktextract entry (one JSON line of the raw dump), or null
 * for anything that is not an Arabic word with at least one real sense.
 */
export function wiktionaryRow(entry: WiktextractEntry): DictionaryRow | null {
  if (entry.lang_code !== 'ar' || typeof entry.word !== 'string' || typeof entry.pos !== 'string') {
    return null;
  }
  if (SKIPPED_POS.has(entry.pos)) return null;
  const word = bareKey(entry.word);
  if (!/\p{L}/u.test(word)) return null;

  const definitions: string[] = [];
  for (const sense of (Array.isArray(entry.senses) ? entry.senses : []) as WiktextractSense[]) {
    if (strings(sense.tags).some((t) => POINTER_TAGS.has(t))) continue;
    // A subsense lists its parent's gloss first; its own comes last.
    const gloss = strings(sense.glosses).at(-1)?.trim();
    if (gloss && !definitions.includes(gloss)) definitions.push(gloss);
  }
  if (definitions.length === 0) return null;

  const forms = (Array.isArray(entry.forms) ? entry.forms : []) as Array<{ form?: unknown; tags?: unknown }>;
  const canonical = forms.find((f) => typeof f.form === 'string' && strings(f.tags).includes('canonical'));
  const headword = ((canonical?.form as string | undefined) ?? entry.word).normalize('NFC').trim();
  return { word, headword, partOfSpeech: entry.pos, definitions };
}

/** Writes the dictionary database at `path`, which must not exist yet. */
export class DictionaryWriter {
  private readonly db: DatabaseSync;
  private readonly insertEntry: StatementSync;
  private readonly insertExample: StatementSync;
  private entries = 0;
  private examples = 0;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = OFF;
      PRAGMA synchronous = OFF;
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE entries (
        id INTEGER PRIMARY KEY,
        word TEXT NOT NULL,
        headword TEXT NOT NULL,
        pos TEXT NOT NULL,
        definitions TEXT NOT NULL -- JSON array of strings
      );
      CREATE TABLE examples (
        id INTEGER PRIMARY KEY,
        arabic TEXT NOT NULL,
        english TEXT NOT NULL
      );
      BEGIN;
    `);
    this.insertEntry = this.db.prepare(
      'INSERT INTO entries (word, headword, pos, definitions) VALUES (?, ?, ?, ?)',
    );
    this.insertExample = this.db.prepare('INSERT INTO examples (arabic, english) VALUES (?, ?)');
  }

  addEntry(row: DictionaryRow): void {
    this.insertEntry.run(row.word, row.headword, row.partOfSpeech, JSON.stringify(row.definitions));
    this.entries++;
  }

  addExample(pair: ExamplePair): void {
    this.insertExample.run(pair.arabic, pair.english);
    this.examples++;
  }

  /** Records the sources, licences and counts, indexes, and compacts the file. */
  finish(meta: Record<string, string>): { entries: number; examples: number } {
    const counts = { entries: this.entries, examples: this.examples };
    const setMeta = this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries({
      ...meta,
      schema_version: String(SCHEMA_VERSION),
      entries: String(counts.entries),
      examples: String(counts.examples),
    })) {
      setMeta.run(key, value);
    }
    this.db.exec(`
      COMMIT;
      CREATE INDEX entries_by_word ON entries (word);
      VACUUM;
    `);
    this.db.close();
    return counts;
  }
}

/**
 * Tatoeba Arabic-English pairs from the per-language exports: `ara_sentences.tsv` and
 * `eng_sentences.tsv` (id, language, text) and `ara-eng_links.tsv` (Arabic id, English id).
 * Each linked pair once, in Arabic-id order.
 */
export function tatoebaPairs(
  arabic: Map<number, string>,
  english: Map<number, string>,
  links: Array<[number, number]>,
): ExamplePair[] {
  const seen = new Set<string>();
  const pairs: ExamplePair[] = [];
  for (const [araId, engId] of [...links].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const ar = arabic.get(araId);
    const en = english.get(engId);
    const key = `${araId}:${engId}`;
    if (!ar || !en || seen.has(key)) continue;
    seen.add(key);
    pairs.push({ arabic: ar, english: en });
  }
  return pairs;
}

/** Parses one line of a Tatoeba sentences export: id, language, text. */
export function tatoebaSentence(line: string): [number, string] | null {
  const [id, , ...text] = line.split('\t');
  const n = Number(id);
  const sentence = text.join('\t').trim();
  return Number.isInteger(n) && sentence ? [n, sentence] : null;
}
