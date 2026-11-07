/** Accuracy scoring for Arabic transcripts: normalization, then word and character error rates. */

export interface ErrorRate {
  errors: number;
  refLength: number;
  rate: number;
}

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

/**
 * The usual Arabic ASR-evaluation normalization, so that spelling choices the
 * listener cannot hear (diacritics, hamza seat on alef, ta marbuta, alef maqsura)
 * are not counted as errors.
 */
export function normalizeArabic(text: string): string {
  return text
    .normalize('NFC')
    .replace(DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function editDistance<T>(ref: readonly T[], hyp: readonly T[]): number {
  let previous = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const current = [i];
    for (let j = 1; j <= hyp.length; j++) {
      const substitution = previous[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1);
      current[j] = Math.min(substitution, previous[j] + 1, current[j - 1] + 1);
    }
    previous = current;
  }
  return previous[hyp.length];
}

function rate(ref: readonly string[], hyp: readonly string[]): ErrorRate {
  const errors = editDistance(ref, hyp);
  return { errors, refLength: ref.length, rate: ref.length === 0 ? 0 : errors / ref.length };
}

function words(text: string): string[] {
  const normalized = normalizeArabic(text);
  return normalized === '' ? [] : normalized.split(' ');
}

export function wordErrorRate(reference: string, hypothesis: string): ErrorRate {
  return rate(words(reference), words(hypothesis));
}

/** Character error rate over the normalized text with spaces removed, so word splitting is not penalized. */
export function charErrorRate(reference: string, hypothesis: string): ErrorRate {
  const chars = (text: string) => [...normalizeArabic(text).replace(/ /g, '')];
  return rate(chars(reference), chars(hypothesis));
}

/** Keeps the lines that contain Arabic letters, so a bilingual (Arabic + English) transcript can serve as the reference. */
export function arabicLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => /[ء-ي]/.test(line))
    .join('\n');
}
