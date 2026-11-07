import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { Dictionary, DictionaryEntry } from '../providers';
import { bareKey, SCHEMA_VERSION } from './data';

interface EntryRow {
  headword: string;
  pos: string;
  definitions: string;
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

  constructor(path: string) {
    this.db = new DatabaseSync(path, { readOnly: true });
    const version = this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
      | { value: string }
      | undefined;
    if (version?.value !== String(SCHEMA_VERSION)) {
      this.db.close();
      throw new Error(`Dictionary ${path} has schema ${version?.value ?? 'none'}, expected ${SCHEMA_VERSION}`);
    }
    this.byWord = this.db.prepare('SELECT headword, pos, definitions FROM entries WHERE word = ? ORDER BY id');
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
    };
  }

  close(): void {
    this.db.close();
  }
}
