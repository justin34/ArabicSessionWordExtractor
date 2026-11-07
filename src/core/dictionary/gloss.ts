import type { DictionaryEntry } from '../providers';

/** A first alternative longer than this gives way to the shortest one. */
const LONG_ALTERNATIVE = 16;
/** A dictionary gloss longer than this gives way to the stem gloss, when there is one. */
const LONG_GLOSS = 24;

/** Removes text inside (possibly nested) parentheses or brackets, e.g. "(transitive)". */
function withoutQualifiers(text: string): string {
  let out = text;
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(/\([^()]*\)|\[[^[\]]*\]/g, ' ');
  }
  return out.replace(/[()[\]]/g, ' ');
}

/**
 * One alternative of a definition, without qualifiers in parentheses: the first, unless
 * it is long, then the shortest. A verb's alternatives are its "to …" ones. So "to mark
 * (symbols…) on a surface, to write, to inscribe" gives "to write".
 */
export function shortGloss(definition: string): string {
  let clauses = withoutQualifiers(definition)
    .split(/[;,]/)
    .map((c) => c.replace(/[.:]+\s*$/, '').replace(/\s+/g, ' ').trim())
    .filter((c) => /\p{L}/u.test(c));
  if (clauses.length === 0) return definition.trim();
  if (clauses[0].startsWith('to ')) clauses = clauses.filter((c) => c.startsWith('to '));
  if (clauses[0].length <= LONG_ALTERNATIVE) return clauses[0];
  return clauses.reduce((best, c) => (c.length < best.length ? c : best));
}

/**
 * CAMeL's stem gloss as readable English: its first alternative, words spaced, without
 * clitic glosses or bracketed features ("brother_+_my", "you_[masc.sg.]").
 */
export function readableStemGloss(stemGloss: string): string {
  if (stemGloss === 'NO_ANALYSIS') return '';
  const first = (stemGloss.split(';')[0] ?? '').split('+')[0];
  return withoutQualifiers(first.replace(/_/g, ' ')).replace(/\?/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Prepositions, conjunctions, particles and interjections: Wiktionary describes these
 * ("introduces a yes-no question") where CAMeL's stem gloss translates them ("does").
 */
function isFunctionWord(partOfSpeech: string | undefined): boolean {
  return !!partOfSpeech && /^(prep|conj|part|interj|abbrev)/.test(partOfSpeech);
}

/**
 * The gloss shown under a word in Live View (GLOSSARY, Dictionary plan): the dictionary's
 * first sense, shortened, else the analyzer's stem gloss, else nothing. The stem gloss
 * comes first for function words, and for a sense too long to sit under a word.
 */
export function quickGloss(
  entry: DictionaryEntry | undefined,
  stemGloss: string | undefined,
  partOfSpeech?: string,
): string {
  const stem = stemGloss ? readableStemGloss(stemGloss) : '';
  const first = entry?.definitions[0];
  const fromDictionary = first ? shortGloss(first) : '';
  if (stem && (isFunctionWord(partOfSpeech) || !fromDictionary || fromDictionary.length > LONG_GLOSS)) return stem;
  return fromDictionary || stem;
}
