import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { Dictionary, DictionaryEntry, ExampleSentence } from '../providers';
import { bareKey, SCHEMA_VERSION } from './data';

interface EntryRow {
  headword: string;
  pos: string;
  definitions: string;
  etymology: string | null;
}

/**
 * A diacritized form reduced to what CAMeL's `lex` and Wiktionary's headword both spell
 * the same way. CAMeL leaves out the final short vowel (كَتَب for كَتَبَ), the sukun, and
 * the fatha before a long alef (كِتاب for كِتَاب).
 */
export function headwordKey(diacritized: string): string {
  return diacritized
    .normalize('NFC')
    .replace(/ٱ/g, 'ا') // alef wasla
    .replace(/[ـْ]/g, '') // tatweel, sukun
    .replace(/َ(?=[اى])/g, '') // fatha before alef
    .replace(/[ً-ِ]+$/u, ''); // final short vowel or tanween
}

/** Wiktionary parts of speech that a CAMeL part of speech can be listed under. */
function wiktionaryPos(camelPos: string): string[] {
  if (camelPos === 'verb' || camelPos === 'verb_pseudo') return ['verb'];
  // A name is not glossed by a common noun spelled alike (سَيْف Saif, not "sword").
  if (camelPos === 'noun_prop') return ['name'];
  if (camelPos.startsWith('noun_num') || camelPos === 'digit') return ['num', 'noun'];
  if (camelPos.startsWith('noun')) return ['noun'];
  if (camelPos.startsWith('adj')) return ['adj'];
  if (camelPos.startsWith('adv')) return ['adv'];
  if (camelPos.startsWith('pron')) return ['pron', 'det'];
  if (camelPos === 'prep') return ['prep', 'particle'];
  if (camelPos.startsWith('conj')) return ['conj', 'particle'];
  if (camelPos.startsWith('part')) return ['particle', 'adv', 'conj'];
  if (camelPos === 'interj') return ['intj'];
  if (camelPos === 'abbrev') return ['abbrev', 'noun'];
  return [];
}

/**
 * The bundled dictionary (`scripts/build-dictionary.mjs`), opened read-only.
 *
 * A Lemma is found by its letters, and among the entries spelled so, the one whose
 * diacritized headword is the Lemma (من: مِن "from", not مَن "who") and whose part of
 * speech fits (نَعَم "yes" is no verb نَعَمَ "to live in comfort"). With no such entry,
 * only one that is the sole entry with that part of speech is trusted; otherwise there is
 * no entry, and the caller falls back to the analyzer's own gloss.
 */
export class SqliteDictionary implements Dictionary {
  private readonly db: DatabaseSync;
  private readonly byWord: StatementSync;
  private readonly examplesByWord: StatementSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path, { readOnly: true });
    const version = this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
      | { value: string }
      | undefined;
    if (version?.value !== String(SCHEMA_VERSION)) {
      this.db.close();
      throw new Error(`Dictionary ${path} has schema ${version?.value ?? 'none'}, expected ${SCHEMA_VERSION}`);
    }
    this.byWord = this.db.prepare(
      'SELECT headword, pos, definitions, etymology FROM entries WHERE word = ? ORDER BY id',
    );
    // Keys arrive as a JSON array, so one statement serves any number of spellings.
    this.examplesByWord = this.db.prepare(
      // A sentence with several translations is given once, with its first.
      `SELECT e.arabic, e.english, min(e.id) AS first FROM examples e
       WHERE e.id IN (SELECT example_id FROM example_words WHERE word IN (SELECT value FROM json_each(?)))
       GROUP BY e.arabic ORDER BY length(e.arabic), first LIMIT ?`,
    );
  }

  async lookup(lemma: string, partOfSpeech?: string): Promise<DictionaryEntry | undefined> {
    const rows = this.byWord.all(bareKey(lemma)) as unknown as EntryRow[];
    if (rows.length === 0) return undefined;
    const target = headwordKey(lemma);
    // A part of speech we cannot map says nothing either way.
    const allowed = partOfSpeech ? wiktionaryPos(partOfSpeech) : [];
    const posOk = (row: EntryRow) => allowed.length === 0 || allowed.includes(row.pos);
    const spelled = rows.filter((r) => headwordKey(r.headword) === target);
    const best =
      spelled.find(posOk) ??
      (allowed.length > 0 && rows.filter(posOk).length === 1 ? rows.find(posOk) : undefined);
    if (!best) return undefined;
    return {
      lemma,
      headword: best.headword,
      partOfSpeech: best.pos,
      definitions: JSON.parse(best.definitions) as string[],
      ...(best.etymology && { etymology: best.etymology }),
    };
  }

  /** Tatoeba sentences containing any of `words`, shortest first. */
  async examples(words: string[], limit: number): Promise<ExampleSentence[]> {
    const keys = [...new Set(words.map(bareKey).filter(Boolean))];
    if (keys.length === 0 || limit < 1) return [];
    const rows = this.examplesByWord.all(JSON.stringify(keys), limit) as unknown as ExampleSentence[];
    return rows.map(({ arabic, english }) => ({ arabic, english }));
  }

  close(): void {
    this.db.close();
  }
}
