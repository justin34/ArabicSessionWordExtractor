// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FakeBridge, renderApp } from './harness';
import type { VocabularyEntry } from '../../src/core/types';

afterEach(cleanup);

function entry(over: Partial<VocabularyEntry> & { lemmaId: number; lemma: string }): VocabularyEntry {
  return {
    root: null,
    partOfSpeech: null,
    stemGloss: null,
    surfaceForms: [over.lemma],
    firstHeardAt: '2026-01-01T10:00:00.000Z',
    count: 1,
    heardIn: [{ sessionId: 1, utteranceId: 1 }],
    ...over,
  };
}

const words: VocabularyEntry[] = [
  entry({
    lemmaId: 1,
    lemma: 'كَتَب',
    root: 'ك.ت.ب',
    partOfSpeech: 'verb',
    stemGloss: 'write',
    surfaceForms: ['كتب', 'كتبوا'],
    count: 3,
    heardIn: [
      { sessionId: 1, utteranceId: 1 },
      { sessionId: 2, utteranceId: 9 },
    ],
  }),
  entry({ lemmaId: 2, lemma: 'طالِب', root: 'ط.ل.ب', partOfSpeech: 'noun', stemGloss: 'student', surfaceForms: ['الطالب'] }),
  entry({ lemmaId: 3, lemma: 'مَدْرَسَة', root: 'د.ر.س', stemGloss: 'school', surfaceForms: ['المدرسة'] }),
];

async function openVocabulary(vocabulary: VocabularyEntry[]) {
  const user = userEvent.setup();
  const bridge = new FakeBridge();
  bridge.vocabulary = vocabulary;
  renderApp({ bridge });
  await user.click(screen.getByRole('button', { name: 'Vocabulary' }));
  const list = await screen.findByRole('list', { name: 'Vocabulary list' });
  return { user, bridge, list };
}

const shownLemmas = () =>
  within(screen.getByRole('list', { name: 'Vocabulary list' }))
    .getAllByRole('listitem')
    .map((li) => li.getAttribute('aria-label'));

describe('Vocabulary list', () => {
  it('lists every Lemma with its surface forms, gloss and how often it was heard', async () => {
    const { list } = await openVocabulary(words);

    expect(shownLemmas()).toEqual(['كَتَب', 'طالِب', 'مَدْرَسَة']);
    const katab = within(list).getByRole('listitem', { name: 'كَتَب' });
    expect(katab.textContent).toContain('write');
    expect(katab.textContent).toContain('verb · root ك.ت.ب');
    expect(katab.textContent).toContain('كتبوا');
    expect(katab.textContent).toContain('Heard 3 times in 2 Sessions');
    expect(within(list).getByRole('listitem', { name: 'طالِب' }).textContent).toContain(
      'Heard once in 1 Session',
    );
    expect(screen.getByText('3 words')).toBeTruthy();
  });

  it('leaves out the placeholder root CAMeL gives words without a true root', async () => {
    const { list } = await openVocabulary([
      entry({ lemmaId: 4, lemma: 'إِلَى', root: '#.ل.#', partOfSpeech: 'prep' }),
    ]);

    const ila = within(list).getByRole('listitem', { name: 'إِلَى' });
    expect(ila.textContent).toContain('prep');
    expect(ila.textContent).not.toContain('root');
  });

  it('searches by surface form without diacritics, by root, and by English', async () => {
    const { user } = await openVocabulary(words);
    const search = screen.getByRole('searchbox', { name: 'Search vocabulary' });

    await user.type(search, 'كتبوا');
    expect(shownLemmas()).toEqual(['كَتَب']);

    await user.clear(search);
    await user.type(search, 'مدرسه');
    expect(shownLemmas()).toEqual(['مَدْرَسَة']);

    await user.clear(search);
    await user.type(search, 'درس');
    expect(shownLemmas()).toEqual(['مَدْرَسَة']);

    await user.clear(search);
    await user.type(search, 'STUD');
    expect(shownLemmas()).toEqual(['طالِب']);
    expect(screen.getByText('1 of 3 words')).toBeTruthy();
  });

  it('says so when nothing matches the search', async () => {
    const { user } = await openVocabulary(words);

    await user.type(screen.getByRole('searchbox', { name: 'Search vocabulary' }), 'zzz');

    expect(screen.getByText('No matching words')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Vocabulary list' })).toBeNull();
  });

  it('shows words heard since it was last opened', async () => {
    const { user, bridge } = await openVocabulary(words.slice(0, 1));
    expect(shownLemmas()).toEqual(['كَتَب']);

    bridge.vocabulary = words;
    await user.click(screen.getByRole('button', { name: 'Sessions' }));
    await user.click(screen.getByRole('button', { name: 'Vocabulary' }));

    await screen.findByText('3 words');
    expect(shownLemmas()).toEqual(['كَتَب', 'طالِب', 'مَدْرَسَة']);
  });
});
