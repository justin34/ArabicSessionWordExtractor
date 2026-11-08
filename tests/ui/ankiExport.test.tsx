// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionGuide, VocabularyEntry } from '../../src/core/types';
import { FakeBridge, ManualDemoFeed, renderApp, session } from './harness';

afterEach(cleanup);

const word: VocabularyEntry = {
  lemmaId: 1,
  lemma: 'كَتَب',
  root: 'ك.ت.ب',
  partOfSpeech: 'verb',
  stemGloss: 'write',
  surfaceForms: ['كتب'],
  firstHeardAt: '2026-01-01T10:00:00.000Z',
  count: 1,
  heardIn: [{ sessionId: 1, utteranceId: 1 }],
};

function guide(words: SessionGuide['groups'][number]['words']): SessionGuide {
  return {
    sessionId: 1,
    generatedAt: '2026-01-01T10:05:00.000Z',
    lemmasHeard: 1,
    groups: words.length > 0 ? [{ title: 'Verbs', words }] : [],
  };
}

async function openVocabulary(bridge: FakeBridge) {
  const user = userEvent.setup();
  renderApp({ bridge });
  await user.click(screen.getByRole('button', { name: 'Vocabulary' }));
  return { user, button: await screen.findByRole('button', { name: 'Export to Anki' }) };
}

async function openGuide(bridge: FakeBridge) {
  const user = userEvent.setup();
  renderApp({ bridge });
  await user.click(await screen.findByRole('button', { name: /open session/i }));
  await user.click(screen.getByRole('tab', { name: 'Session Guide' }));
  return { user, button: await screen.findByRole('button', { name: 'Export to Anki' }) };
}

describe('Export to Anki on the Vocabulary screen', () => {
  it('exports the whole Vocabulary, then says how many words and where, with the voice it needs', async () => {
    const bridge = new FakeBridge();
    bridge.vocabulary = [word];
    const { user, button } = await openVocabulary(bridge);

    await user.click(button);

    expect(bridge.exports).toEqual([{ kind: 'vocabulary' }]);
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Exported 3 words to arabic-vocabulary-2026-11-07.apkg.');
    expect(status.textContent).toContain(
      "Cards speak each word with your device's Arabic voice; on Windows, add it under Settings › Time & language › Speech",
    );

    await user.click(screen.getByRole('button', { name: 'Show in folder' }));
    expect(bridge.shownFiles).toEqual([bridge.exportResult!.path]);
  });

  it('is disabled on an empty Vocabulary', async () => {
    const { button } = await openVocabulary(new FakeBridge());
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows nothing when the Save dialog is cancelled', async () => {
    const bridge = new FakeBridge();
    bridge.vocabulary = [word];
    bridge.exportResult = null;
    const { user, button } = await openVocabulary(bridge);

    await user.click(button);

    expect(bridge.exports).toHaveLength(1);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so when the export fails', async () => {
    const bridge = new FakeBridge();
    bridge.vocabulary = [word];
    bridge.exportError = new Error('The deck could not be saved: disk full');
    const { user, button } = await openVocabulary(bridge);

    await user.click(button);

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not export to Anki: The deck could not be saved: disk full',
    );
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('Export to Anki on a Session Guide', () => {
  it("exports that Session's new words", async () => {
    const bridge = new FakeBridge([session({ id: 1 })]);
    bridge.sessionGuides.set(1, guide([{ lemmaId: 1, lemma: 'كَتَب', gloss: 'to write', partOfSpeech: 'verb', count: 1 }]));
    bridge.exportResult = { count: 1, path: '/home/me/session-2026-01-01-new-words.apkg' };
    const { user, button } = await openGuide(bridge);

    await user.click(button);

    expect(bridge.exports).toEqual([{ kind: 'session', sessionId: 1 }]);
    expect((await screen.findByRole('status')).textContent).toContain(
      'Exported 1 word to session-2026-01-01-new-words.apkg.',
    );
  });

  it('is disabled when the Session Guide has no new words', async () => {
    const bridge = new FakeBridge([session({ id: 1 })]);
    bridge.sessionGuides.set(1, guide([]));
    const { button } = await openGuide(bridge);

    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('is not offered for a Demo Session', async () => {
    const user = userEvent.setup();
    const demo = new ManualDemoFeed();
    renderApp({ demo });
    await user.click(screen.getByRole('button', { name: /demo/i }));
    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await user.click(await screen.findByRole('button', { name: /open session/i }));

    expect(screen.queryByRole('tab', { name: 'Session Guide' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export to Anki' })).toBeNull();
  });
});
