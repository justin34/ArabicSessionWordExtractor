/**
 * One Anki note per Lemma (GLOSSARY: Anki export), filled from the same sources as the
 * word panel's built-in Detail Modules (ADR 0002), whatever `detail-modules.json` enables:
 * the fields are fixed so the note type never changes between exports.
 */
import { learnableRoot, readablePartOfSpeech } from '../details/modules';
import { bareKey } from '../dictionary/data';
import { quickGloss } from '../dictionary/gloss';
import { headwordKey } from '../dictionary/sqlite';
import type { Dictionary, DictionaryEntry, ExampleSentence } from '../providers';
import type { LemmaRecord, Store } from '../store';
import type { AnkiNote, FieldName } from './package';

const MAX_DEFINITIONS = 8;
/** Example sentences asked for; the shortest of them goes on the card. */
const EXAMPLES_ASKED = 3;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** An ISO time's calendar date where the learner is, as YYYY-MM-DD. */
export function localDate(at: string | number | Date): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A sentence as HTML, with each word that is one of `spellings` (compared without
 * diacritics, ignoring punctuation around it) marked `<span class="hl">`.
 */
export function highlightWord(sentence: string, spellings: string[]): string {
  const keys = new Set(spellings.map(bareKey).filter(Boolean));
  return sentence
    .split(/(\s+)/)
    .map((part) => {
      const [, lead = '', core = '', trail = ''] = /^([\p{P}\p{S}]*)(.*?)([\p{P}\p{S}]*)$/su.exec(part) ?? [];
      if (!core || !keys.has(bareKey(core))) return escapeHtml(part);
      return `${escapeHtml(lead)}<span class="hl">${escapeHtml(core)}</span>${escapeHtml(trail)}`;
    })
    .join('');
}

/** The pronunciation of the Lemma itself: that of a form heard spelled as the Lemma. */
function lemmaPronunciation(lemma: LemmaRecord): string {
  const target = headwordKey(lemma.lemma);
  const form = lemma.forms.find((f) => f.pronunciation && f.diacritized && headwordKey(f.diacritized) === target);
  return form?.pronunciation ?? '';
}

/** A tag Anki keeps whole: no spaces. */
const tagPart = (text: string) => text.trim().replace(/\s+/g, '_');

async function settle<T>(work: () => Promise<T>, what: string, lemma: string): Promise<T | undefined> {
  try {
    return await work();
  } catch (err) {
    console.error(`Anki export: ${what} failed for ${lemma}:`, err);
    return undefined;
  }
}

/** The note for one Lemma, or undefined for an id not in the Vocabulary. */
export async function ankiNote(store: Store, dictionary: Dictionary, lemmaId: number): Promise<AnkiNote | undefined> {
  const lemma = store.getLemma(lemmaId);
  if (!lemma) return undefined;
  const pos = lemma.partOfSpeech ?? undefined;
  const spellings = [lemma.lemma, ...lemma.forms.flatMap((f) => [f.surface, f.diacritized ?? ''])].filter(Boolean);

  const [entry, examples] = await Promise.all([
    settle<DictionaryEntry | undefined>(() => dictionary.lookup(lemma.lemma, pos), 'dictionary lookup', lemma.lemma),
    settle<ExampleSentence[]>(
      () => dictionary.examples([lemma.lemma, ...lemma.forms.map((f) => f.surface)], EXAMPLES_ASKED),
      'example lookup',
      lemma.lemma,
    ),
  ]);
  const own = store.lemmaUtterances(lemma.id, 1)[0];
  const example = examples?.reduce<ExampleSentence | undefined>(
    (best, e) => (!best || e.arabic.length < best.arabic.length ? e : best),
    undefined,
  );
  const definitions = entry?.definitions.slice(0, MAX_DEFINITIONS) ?? [];
  const root = learnableRoot(lemma.root);

  const fields: Record<FieldName, string> = {
    Lemma: escapeHtml(lemma.lemma),
    Gloss: escapeHtml(quickGloss(entry, lemma.stemGloss ?? undefined, pos)),
    Definitions:
      definitions.length > 0 ? `<ol>${definitions.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ol>` : '',
    PartOfSpeech: pos ? escapeHtml(readablePartOfSpeech(pos)) : '',
    Root: root ? escapeHtml(root) : '',
    Pattern: lemma.pattern ? escapeHtml(lemma.pattern) : '',
    Pronunciation: escapeHtml(lemmaPronunciation(lemma)),
    FormsHeard: escapeHtml(lemma.forms.map((f) => f.surface).join('، ')),
    MyExample: own ? highlightWord(own.text, spellings) : '',
    MyExampleTranslation: own ? escapeHtml(own.translation) : '',
    Example: example ? highlightWord(example.arabic, spellings) : '',
    ExampleTranslation: example ? escapeHtml(example.english) : '',
  };

  const tags: string[] = [];
  if (pos) tags.push(`pos::${tagPart(readablePartOfSpeech(pos))}`);
  const sessions = store.lemmaSessions(lemma.id);
  const first = sessions[sessions.length - 1];
  if (first) tags.push(`session::${localDate(first.startedAt)}`);

  const card = store.getWordCard(lemma.id);
  return {
    key: lemma.lemma,
    fields,
    tags,
    modifiedMs: new Date(card?.updatedAt ?? lemma.firstHeardAt).getTime(),
  };
}
