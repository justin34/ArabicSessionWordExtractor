import type { VocabularyEntry } from './bridge';

/**
 * Folds the spelling differences a learner should not have to type: diacritics and
 * tatweel, the hamza forms of alef, alef maqsura and ta marbuta, and letter case.
 */
export function foldForSearch(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\p{M}ـ]/gu, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .trim();
}

/**
 * True when the query appears in the Lemma, any surface form heard, the root (typed
 * with or without its dots), or the English stem gloss. An empty query matches all.
 */
export function matchesVocabulary(entry: VocabularyEntry, query: string): boolean {
  const q = foldForSearch(query);
  if (!q) return true;
  const fields = [
    entry.lemma,
    ...entry.surfaceForms,
    entry.root ?? '',
    (entry.root ?? '').replace(/\./g, ''),
    entry.stemGloss ?? '',
  ];
  return fields.some((f) => foldForSearch(f).includes(q));
}
