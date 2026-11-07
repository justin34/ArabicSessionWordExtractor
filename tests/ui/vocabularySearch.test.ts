import { describe, expect, it } from 'vitest';
import { foldForSearch, matchesVocabulary } from '../../src/renderer/vocabularySearch';
import type { VocabularyEntry } from '../../src/core/types';

const kitab: VocabularyEntry = {
  lemmaId: 1,
  lemma: 'كِتاب',
  root: 'ك.ت.ب',
  partOfSpeech: 'noun',
  stemGloss: 'book',
  surfaceForms: ['الكتاب', 'بكتابهم'],
  firstHeardAt: '2026-01-01T10:00:00.000Z',
  count: 2,
  heardIn: [],
};

describe('Vocabulary search', () => {
  it('folds diacritics, tatweel, hamza on alef, alef maqsura, ta marbuta and case', () => {
    expect(foldForSearch('  إِلَى ')).toBe('الي');
    expect(foldForSearch('مـدرسة')).toBe('مدرسه');
    expect(foldForSearch('Book')).toBe('book');
  });

  it('matches the Lemma, a surface form, the root with or without dots, or the gloss', () => {
    for (const q of ['كتاب', 'كِتَاب', 'بكتابهم', 'ك.ت.ب', 'كتب', 'boo']) {
      expect(matchesVocabulary(kitab, q)).toBe(true);
    }
    expect(matchesVocabulary(kitab, 'قلم')).toBe(false);
    expect(matchesVocabulary(kitab, 'pen')).toBe(false);
  });

  it('matches everything when the query is blank', () => {
    expect(matchesVocabulary(kitab, '   ')).toBe(true);
  });
});
