// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionGuide, VocabularyEntry, WordCard } from '../../src/core/types';
import { FakeBridge, renderApp, session } from './harness';

afterEach(() => {
  cleanup();
});

const guide: SessionGuide = {
  sessionId: 1,
  generatedAt: '2026-01-01T10:05:00.000Z',
  lemmasHeard: 5,
  groups: [
    {
      title: 'Nouns',
      words: [
        { lemmaId: 2, lemma: 'طالِب', gloss: 'student', partOfSpeech: 'noun', count: 2 },
        { lemmaId: 3, lemma: 'دَرْس', gloss: 'lesson', partOfSpeech: 'noun', count: 1 },
      ],
    },
    { title: 'Verbs', words: [{ lemmaId: 1, lemma: 'كَتَب', gloss: 'to write', partOfSpeech: 'verb', count: 1 }] },
  ],
};

const katab: WordCard = {
  lemmaId: 1,
  lemma: 'كَتَب',
  generatedAt: '2026-01-01T10:01:00.000Z',
  updatedAt: '2026-01-01T10:05:00.000Z',
  sections: [
    { moduleId: 'form', title: 'Form', blocks: [{ kind: 'facts', facts: [{ label: 'Root', value: 'ك.ت.ب', arabic: true }] }] },
    { moduleId: 'definitions', title: 'Definitions', blocks: [{ kind: 'list', ordered: true, items: [{ text: 'to write' }] }] },
  ],
};

function bridgeWithGuide(): FakeBridge {
  const bridge = new FakeBridge([session({ id: 1 })]);
  bridge.sessionGuides.set(1, guide);
  bridge.wordCards.set(1, katab);
  return bridge;
}

async function openSession(bridge: FakeBridge) {
  const user = userEvent.setup();
  renderApp({ bridge });
  await user.click(await screen.findByRole('button', { name: /open session/i }));
  await user.click(screen.getByRole('tab', { name: 'Session Guide' }));
  return user;
}

describe('Session Guide', () => {
  it("opens with a completed Session, listing its new words grouped, with glosses and times heard", async () => {
    await openSession(bridgeWithGuide());

    expect(await screen.findByRole('tabpanel', { name: 'Session Guide' })).toBeTruthy();
    expect(await screen.findByText('3 new words · 5 words heard')).toBeTruthy();
    const nouns = screen.getByRole('region', { name: 'Nouns' });
    expect(within(nouns).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'طالِبstudentheard 2 times',
      'دَرْسlessonheard once',
    ]);
    expect(within(screen.getByRole('region', { name: 'Verbs' })).getByText('to write')).toBeTruthy();
  });

  it("opens a word's Word Card, and goes back to the Session Guide", async () => {
    const bridge = bridgeWithGuide();
    const user = await openSession(bridge);

    await user.click(await screen.findByRole('button', { name: 'Word Card for كَتَب' }));

    expect(await screen.findByRole('heading', { name: 'كَتَب' })).toBeTruthy();
    expect(bridge.calls).toContain('wordCard:1');
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Form', 'Definitions']);
    expect(screen.getByText('to write')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sessions', current: 'page' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /back to session guide/i }));
    expect(await screen.findByRole('tabpanel', { name: 'Session Guide' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Session Guide', selected: true })).toBeTruthy();
  });

  it('says when a Session has no new words', async () => {
    const bridge = new FakeBridge([session({ id: 1 })]);
    bridge.sessionGuides.set(1, { ...guide, groups: [] });
    await openSession(bridge);

    expect(await screen.findByText('No new words')).toBeTruthy();
    expect(screen.getByText(/already in your Vocabulary/)).toBeTruthy();
  });

  it('says when there is no Session Guide, or it cannot be loaded', async () => {
    const bridge = new FakeBridge([session({ id: 1 })]);
    await openSession(bridge);
    expect(await screen.findByText('No Session Guide yet')).toBeTruthy();
    cleanup();

    const failing = new FakeBridge([session({ id: 1 })]);
    failing.guideError = new Error('database closed');
    await openSession(failing);
    expect(await screen.findByText('Could not load the Session Guide')).toBeTruthy();
    expect(screen.getByText('database closed')).toBeTruthy();
  });
});

describe('Word Card from the Vocabulary', () => {
  const entry: VocabularyEntry = {
    lemmaId: 1,
    lemma: 'كَتَب',
    root: 'ك.ت.ب',
    partOfSpeech: 'verb',
    stemGloss: 'write',
    surfaceForms: ['كتب'],
    firstHeardAt: '2026-01-01T10:01:00.000Z',
    count: 1,
    heardIn: [{ sessionId: 1, utteranceId: 1 }],
  };

  it('opens from a Vocabulary entry and goes back to the Vocabulary', async () => {
    const user = userEvent.setup();
    const bridge = bridgeWithGuide();
    bridge.vocabulary = [entry];
    renderApp({ bridge });
    await user.click(screen.getByRole('button', { name: 'Vocabulary' }));

    await user.click(await screen.findByRole('button', { name: 'Word Card for كَتَب' }));

    expect(await screen.findByRole('heading', { name: 'كَتَب' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Definitions' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Vocabulary', current: 'page' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /back to vocabulary/i }));
    expect(await screen.findByRole('list', { name: 'Vocabulary list' })).toBeTruthy();
  });

  it('says when a word has no Word Card yet', async () => {
    const user = userEvent.setup();
    const bridge = new FakeBridge();
    bridge.vocabulary = [entry];
    renderApp({ bridge });
    await user.click(screen.getByRole('button', { name: 'Vocabulary' }));

    await user.click(await screen.findByRole('button', { name: 'Word Card for كَتَب' }));

    expect(await screen.findByText('No Word Card yet')).toBeTruthy();
  });
});
