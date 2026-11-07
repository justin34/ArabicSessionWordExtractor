import { describe, expect, it } from 'vitest';
import { arabicLines, charErrorRate, normalizeArabic, wordErrorRate } from './score.ts';

describe('normalizeArabic', () => {
  it('strips diacritics, tatweel and punctuation, and folds letter variants', () => {
    expect(normalizeArabic('إِنَّ الكِتابَ، مُفيـــدٌ جداً!')).toBe('ان الكتاب مفيد جدا');
    expect(normalizeArabic('أحمد وآمنة في المدرسةِ على')).toBe('احمد وامنه في المدرسه علي');
  });

  it('collapses whitespace and drops Latin punctuation', () => {
    expect(normalizeArabic('  مرحبا ,  بكم .  ')).toBe('مرحبا بكم');
  });
});

describe('wordErrorRate', () => {
  it('is zero for identical text after normalization', () => {
    expect(wordErrorRate('مَرْحَباً بِكُم', 'مرحبا بكم')).toEqual({ errors: 0, refLength: 2, rate: 0 });
  });

  it('counts substitutions, insertions and deletions', () => {
    // ref: a b c d ; hyp: a x c (sub b->x, delete d)
    expect(wordErrorRate('ذهب الولد الى المدرسة', 'ذهب البنت الى')).toEqual({
      errors: 2,
      refLength: 4,
      rate: 0.5,
    });
    expect(wordErrorRate('كتب', 'كتب الدرس').errors).toBe(1);
  });
});

describe('charErrorRate', () => {
  it('scores characters with spaces ignored', () => {
    const result = charErrorRate('كتب', 'كتاب');
    expect(result).toEqual({ errors: 1, refLength: 3, rate: 1 / 3 });
  });
});

describe('arabicLines', () => {
  it('keeps only the Arabic lines of a bilingual transcript', () => {
    const bilingual = ['السلام عليكم', 'Peace be upon you.', '', 'كيف حالك؟', 'How are you?', ''].join('\r\n');
    expect(arabicLines(bilingual)).toBe('السلام عليكم\nكيف حالك؟');
  });
});
