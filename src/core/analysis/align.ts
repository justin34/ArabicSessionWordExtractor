import type { TokenAnalysis } from '../providers';
import type { Token } from '../types';

/** A word's letters and digits only: no punctuation, spaces or diacritics. */
export function letters(word: string): string {
  return word.normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '');
}

/** True when a word has something to learn: at least one letter. */
export function isWord(surface: string): boolean {
  return /\p{L}/u.test(surface);
}

/** The surface form as heard, without the punctuation speech-to-text attaches to it. */
export function cleanSurface(surface: string): string {
  return surface.normalize('NFC').replace(/[^\p{L}\p{M}\p{N}]/gu, '');
}

/**
 * Matches the analyzer's words to the Utterance's timed Tokens. The analyzer splits the
 * sentence itself and drops punctuation, so its words need not be one-to-one with the
 * speech-to-text words: a Token can cover several analyzed words, and a Token or word
 * the other side lacks is skipped. Returns, per analyzed word, the index of its Token,
 * or null when it matches none.
 */
export function alignToTokens(analyses: TokenAnalysis[], tokens: Token[]): Array<number | null> {
  const result: Array<number | null> = analyses.map(() => null);
  const keys = analyses.map((a) => letters(a.surface));
  let next = 0;
  for (let t = 0; t < tokens.length && next < analyses.length; t++) {
    const key = letters(tokens[t].surface);
    if (!key) continue;
    // The usual case: the next analyzed word(s) spell this Token.
    let joined = '';
    let end = next;
    while (end < analyses.length && joined.length < key.length) joined += keys[end++];
    if (joined === key) {
      for (let i = next; i < end; i++) result[i] = t;
      next = end;
      continue;
    }
    // Out of step: look ahead for this Token, and pick up from there.
    const found = keys.indexOf(key, next);
    if (found >= 0) {
      result[found] = t;
      next = found + 1;
    }
  }
  return result;
}
