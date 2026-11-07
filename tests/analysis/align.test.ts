import { describe, expect, it } from 'vitest';
import { alignToTokens, cleanSurface, hasArabicWord, isArabicWord, isWord } from '../../src/core/analysis/align';
import type { TokenAnalysis } from '../../src/core/providers';
import type { Token } from '../../src/core/types';

const tokens = (...surfaces: string[]): Token[] =>
  surfaces.map((surface, i) => ({ surface, startMs: i, endMs: i + 1, gloss: '', lemmaId: null }));
const words = (...surfaces: string[]): TokenAnalysis[] =>
  surfaces.map((surface) => ({ surface, lemma: surface }));

describe('Matching analyzed words to timed Tokens', () => {
  it('pairs them one to one, ignoring punctuation speech-to-text attached', () => {
    expect(
      alignToTokens(words('كتب', 'الطالب', 'الدرس'), tokens('كتب', 'الطالب', '«الدرس».')),
    ).toEqual([0, 1, 2]);
  });

  it('ignores diacritics on either side', () => {
    expect(alignToTokens(words('كَتَبَ', 'الدرس'), tokens('كتب', 'الدَّرْسَ'))).toEqual([0, 1]);
  });

  it('gives every word of a Token the analyzer split to that Token', () => {
    expect(alignToTokens(words('مرحبا', 'بكم', 'جميعا'), tokens('مرحبا-بكم', 'جميعا'))).toEqual([
      0, 0, 1,
    ]);
  });

  it('skips a Token that is only punctuation', () => {
    expect(alignToTokens(words('نعم', 'شكرا'), tokens('نعم', '،', 'شكرا'))).toEqual([0, 2]);
  });

  it('gets back in step after a word the other side lacks', () => {
    expect(alignToTokens(words('ذهب', 'الولد', 'إلى', 'البيت'), tokens('ذهب', 'إلى', 'البيت'))).toEqual(
      [0, null, 1, 2],
    );
    expect(alignToTokens(words('ذهب', 'البيت'), tokens('ذهب', 'آه', 'البيت'))).toEqual([0, 2]);
  });

  it('leaves every word unmatched when there are no Tokens', () => {
    expect(alignToTokens(words('مرحبا', 'بكم'), [])).toEqual([null, null]);
  });
});

describe('Surface forms', () => {
  it('drops punctuation but keeps letters and diacritics', () => {
    expect(cleanSurface('«كَتَبُوا»،')).toBe('كَتَبُوا');
  });

  it('counts only something with a letter as a word', () => {
    expect(isWord('كتب')).toBe(true);
    expect(isWord('٢٠٢٦')).toBe(false);
    expect(isWord('.')).toBe(false);
  });
});

describe('Arabic words and Foreign words', () => {
  it('takes a word of Arabic letters, with or without diacritics, hamza forms, ة, ى, tatweel or punctuation', () => {
    for (const w of ['كتب', 'كَتَبُوا', 'أإآؤئءٱ', 'مدرسة', 'على', 'جميـــل', '«الدرس».', '٣ساعات']) {
      expect(isArabicWord(w), w).toBe(true);
    }
  });

  it('calls any word with a Latin or non-Arabic letter a Foreign word, mixed words included', () => {
    for (const w of ['okay', 'Zoom', 'الiPhone', 'بالـGPS', 'پیام', 'گوگل', 'ڤيروس', 'چای']) {
      expect(isArabicWord(w), w).toBe(false);
    }
  });

  it('is not a word without letters', () => {
    for (const w of ['', '123', '٣', '،', 'ـــ']) expect(isArabicWord(w), w).toBe(false);
  });

  it('a sentence has an Arabic word unless all its words are Foreign words', () => {
    expect(hasArabicWord('Okay, can everyone hear me?')).toBe(false);
    expect(hasArabicWord('Okay, مرحبا')).toBe(true);
  });
});
