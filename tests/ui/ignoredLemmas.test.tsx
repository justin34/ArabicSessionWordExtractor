// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LiveUtterance, SessionGuide, Utterance, VocabularyEntry, WordDetails } from '../../src/core/types';
import { FakeBridge, renderApp, session } from './harness';

afterEach(cleanup);

function entry(lemmaId: number, lemma: string, stemGloss: string): VocabularyEntry {
  return {
    lemmaId,
    lemma,
    root: null,
    partOfSpeech: 'noun',
    stemGloss,
    surfaceForms: [lemma],
    firstHeardAt: '2026-01-01T10:00:00.000Z',
    count: 1,
    heardIn: [{ sessionId: 1, utteranceId: 1 }],
    ignored: false,
  };
}

const words = [entry(1, 'كَتَب', 'write'), entry(2, 'طالِب', 'student'), entry(3, 'مَدْرَسَة', 'school')];

const katab: WordDetails = {
  lemmaId: 1,
  lemma: 'كَتَب',
  sections: [{ moduleId: 'definitions', title: 'Definitions', blocks: [{ kind: 'list', items: [{ text: 'to write' }] }] }],
};

const guide: SessionGuide = {
  sessionId: 1,
  generatedAt: '2026-01-01T10:05:00.000Z',
  lemmasHeard: 3,
  groups: [
    {
      title: 'Nouns',
      words: [
        { lemmaId: 2, lemma: 'طالِب', gloss: 'student', partOfSpeech: 'noun', count: 2 },
        { lemmaId: 3, lemma: 'مَدْرَسَة', gloss: 'school', partOfSpeech: 'noun', count: 1 },
      ],
    },
    { title: 'Verbs', words: [{ lemmaId: 1, lemma: 'كَتَب', gloss: 'to write', partOfSpeech: 'verb', count: 1 }] },
  ],
};

const undoNotice = () => screen.getByRole('status', { name: 'Ignored word' });
const row = (lemma: string) => within(screen.getByRole('list', { name: 'Vocabulary list' })).getByRole('listitem', { name: lemma });
const listed = () =>
  within(screen.getByRole('list', { name: 'Vocabulary list' }))
    .getAllByRole('listitem')
    .map((li) => li.getAttribute('aria-label'));

async function openVocabulary(bridge = new FakeBridge()) {
  const user = userEvent.setup();
  bridge.vocabulary = words;
  renderApp({ bridge });
  await user.click(screen.getByRole('button', { name: 'Vocabulary' }));
  await screen.findByRole('list', { name: 'Vocabulary list' });
  return { user, bridge };
}

describe('Ignoring a word from the Vocabulary', () => {
  it('keeps it listed, marked Ignored, out of the word count, with an Undo notice', async () => {
    const { user, bridge } = await openVocabulary();
    expect(screen.getByText('3 words')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Ignore طالِب' }));

    expect(bridge.ignoreCalls).toEqual([{ lemmaId: 2, ignored: true }]);
    expect(await screen.findByText('2 words · 1 ignored')).toBeTruthy();
    expect(listed()).toEqual(['كَتَب', 'طالِب', 'مَدْرَسَة']);
    expect(within(row('طالِب')).getByText('Ignored')).toBeTruthy();
    expect(within(row('طالِب')).getByRole('button', { name: 'Stop ignoring طالِب' })).toBeTruthy();
    expect(within(row('كَتَب')).queryByText('Ignored')).toBeNull();
    expect(undoNotice().textContent).toContain('Ignored طالِب');
    expect(undoNotice().textContent).toContain('suspend or delete its note there');
  });

  it('Undo stops ignoring it', async () => {
    const { user, bridge } = await openVocabulary();
    await user.click(screen.getByRole('button', { name: 'Ignore طالِب' }));
    await screen.findByText('2 words · 1 ignored');

    await user.click(within(undoNotice()).getByRole('button', { name: 'Undo' }));

    expect(bridge.ignoreCalls.at(-1)).toEqual({ lemmaId: 2, ignored: false });
    expect(await screen.findByText('3 words')).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Ignored word' })).toBeNull();
    expect(within(row('طالِب')).queryByText('Ignored')).toBeNull();
  });

  it('Stop ignoring on the row restores it', async () => {
    const bridge = new FakeBridge();
    bridge.ignored.add(3);
    const { user } = await openVocabulary(bridge);
    expect(screen.getByText('2 words · 1 ignored')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Stop ignoring مَدْرَسَة' }));

    expect(await screen.findByText('3 words')).toBeTruthy();
    expect(bridge.ignoreCalls).toEqual([{ lemmaId: 3, ignored: false }]);
  });

  it('the Ignored filter lists only Ignored Lemmas, and search still finds them', async () => {
    const bridge = new FakeBridge();
    bridge.ignored.add(1);
    bridge.ignored.add(3);
    const { user } = await openVocabulary(bridge);

    const filter = screen.getByRole('button', { name: 'Ignored' });
    expect(filter.getAttribute('aria-pressed')).toBe('false');
    await user.type(screen.getByRole('searchbox', { name: 'Search vocabulary' }), 'school');
    expect(listed()).toEqual(['مَدْرَسَة']);
    expect(screen.getByText('0 of 1 word · 1 of 2 ignored')).toBeTruthy();

    await user.clear(screen.getByRole('searchbox', { name: 'Search vocabulary' }));
    await user.click(filter);
    expect(filter.getAttribute('aria-pressed')).toBe('true');
    expect(listed()).toEqual(['كَتَب', 'مَدْرَسَة']);
    expect(screen.getByText('2 ignored')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Stop ignoring كَتَب' }));
    await user.click(await screen.findByRole('button', { name: 'Stop ignoring مَدْرَسَة' }));
    expect(await screen.findByText('No ignored words')).toBeTruthy();
  });

  it('disables Export to Anki when every word is ignored', async () => {
    const bridge = new FakeBridge();
    [1, 2].forEach((id) => bridge.ignored.add(id));
    const { user } = await openVocabulary(bridge);
    expect((screen.getByRole('button', { name: 'Export to Anki' }) as HTMLButtonElement).disabled).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Ignore مَدْرَسَة' }));

    await screen.findByText('0 words · 3 ignored');
    expect((screen.getByRole('button', { name: 'Export to Anki' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says so when the word cannot be ignored', async () => {
    const bridge = new FakeBridge();
    bridge.ignoreError = new Error('database is locked');
    const { user } = await openVocabulary(bridge);

    await user.click(screen.getByRole('button', { name: 'Ignore طالِب' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Could not ignore طالِب: database is locked');
    expect(screen.queryByRole('status', { name: 'Ignored word' })).toBeNull();
  });
});

describe('Ignoring a word from a Session Guide', () => {
  async function openGuide() {
    const user = userEvent.setup();
    const bridge = new FakeBridge([session({ id: 1 })]);
    bridge.sessionGuides.set(1, guide);
    renderApp({ bridge });
    await user.click(await screen.findByRole('button', { name: /open session/i }));
    await user.click(screen.getByRole('tab', { name: 'Session Guide' }));
    await screen.findByText('3 new words · 3 words heard');
    return { user, bridge };
  }

  it('takes it out of the guide, and Undo brings it back', async () => {
    const { user, bridge } = await openGuide();

    await user.click(screen.getByRole('button', { name: 'Ignore كَتَب' }));

    expect(bridge.ignoreCalls).toEqual([{ lemmaId: 1, ignored: true }]);
    expect(await screen.findByText('2 new words · 3 words heard')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Verbs' })).toBeNull();
    expect(undoNotice().textContent).toContain('Ignored كَتَب');

    await user.click(within(undoNotice()).getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('3 new words · 3 words heard')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Verbs' })).toBeTruthy();
  });

  it('a guide whose new words are all ignored is empty, with Export to Anki disabled', async () => {
    const { user } = await openGuide();

    for (const lemma of ['كَتَب', 'طالِب', 'مَدْرَسَة']) {
      await user.click(await screen.findByRole('button', { name: `Ignore ${lemma}` }));
    }

    expect(await screen.findByText('No new words')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Export to Anki' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Ignoring a word from the word panel', () => {
  const panel = () => screen.getByRole('complementary', { name: 'Word details' });

  it('in Live View: shows Ignored and Stop ignoring, and leaves the transcript as it was', async () => {
    const user = userEvent.setup();
    const bridge = new FakeBridge();
    bridge.details.set(1, katab);
    renderApp({ bridge });
    await user.click(await screen.findByRole('button', { name: 'Start Session' }));
    await user.click(screen.getByRole('button', { name: 'Start' }));
    const update: LiveUtterance = {
      id: 'a',
      isFinal: true,
      text: 'كتبوا',
      translation: 'They wrote.',
      tokens: [{ surface: 'كتبوا', gloss: 'they wrote', lemmaId: 1, startMs: 0, endMs: 400 }],
    };
    act(() => bridge.emit(1, update));
    await user.click(await screen.findByRole('button', { name: 'Show details for كتبوا' }));

    await user.click(await within(panel()).findByRole('button', { name: 'Ignore كَتَب' }));

    expect(bridge.ignoreCalls).toEqual([{ lemmaId: 1, ignored: true }]);
    expect(await within(panel()).findByText('Ignored')).toBeTruthy();
    expect(within(panel()).getByText('to write')).toBeTruthy();
    expect(undoNotice().textContent).toContain('Ignored كَتَب');
    expect(screen.getByRole('button', { name: 'Show details for كتبوا' })).toBeTruthy();
    // Still glossed in the transcript, as well as under the panel's heading.
    expect(screen.getAllByText('they wrote')).toHaveLength(2);

    await user.click(within(panel()).getByRole('button', { name: 'Stop ignoring كَتَب' }));
    expect(await within(panel()).findByRole('button', { name: 'Ignore كَتَب' })).toBeTruthy();
    expect(within(panel()).queryByText('Ignored')).toBeNull();
    expect(screen.queryByRole('status', { name: 'Ignored word' })).toBeNull();
  });

  it('in Replay View, with Undo', async () => {
    const user = userEvent.setup();
    const bridge = new FakeBridge([session({ id: 1 })]);
    const heard: Utterance = {
      id: 1,
      sessionId: 1,
      text: 'كتبوا',
      translation: 'They wrote.',
      startMs: 0,
      endMs: 400,
      track: 'desktop',
      tokens: [{ surface: 'كتبوا', gloss: 'they wrote', lemmaId: 1, startMs: 0, endMs: 400 }],
    };
    bridge.transcripts.set(1, [heard]);
    bridge.details.set(1, katab);
    renderApp({ bridge });
    await user.click(await screen.findByRole('button', { name: /open session/i }));
    await user.click(await screen.findByRole('button', { name: 'Show details for كتبوا' }));

    await user.click(await within(panel()).findByRole('button', { name: 'Ignore كَتَب' }));
    expect(await within(panel()).findByText('Ignored')).toBeTruthy();

    await user.click(within(undoNotice()).getByRole('button', { name: 'Undo' }));
    expect(await within(panel()).findByRole('button', { name: 'Ignore كَتَب' })).toBeTruthy();
    expect(bridge.ignoreCalls).toEqual([
      { lemmaId: 1, ignored: true },
      { lemmaId: 1, ignored: false },
    ]);
  });
});
