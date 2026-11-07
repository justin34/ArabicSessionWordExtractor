// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LiveUtterance, WordDetails } from '../../src/renderer/bridge';
import { FakeBridge, ManualDemoFeed, renderApp } from './harness';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const final = (id: string, words: Array<[string, string, number | null]>): LiveUtterance => ({
  id,
  isFinal: true,
  text: words.map(([w]) => w).join(' '),
  translation: 'They wrote the lesson.',
  tokens: words.map(([surface, gloss, lemmaId], i) => ({
    surface,
    gloss,
    lemmaId,
    startMs: i * 400,
    endMs: i * 400 + 350,
  })),
});

const kataba: WordDetails = {
  lemmaId: 7,
  lemma: 'كَتَب',
  sections: [
    {
      moduleId: 'form',
      title: 'Form',
      blocks: [
        {
          kind: 'facts',
          facts: [
            { label: 'Dictionary form', value: 'كَتَب', arabic: true },
            { label: 'Root', value: 'ك.ت.ب', arabic: true },
          ],
        },
      ],
    },
    {
      moduleId: 'definitions',
      title: 'Definitions',
      blocks: [
        { kind: 'list', ordered: true, items: [{ text: 'to write' }, { text: 'to compose' }] },
        { kind: 'text', heading: 'Etymology', text: 'From the root ك ت ب.' },
      ],
    },
    {
      moduleId: 'own-examples',
      title: 'Your examples',
      blocks: [{ kind: 'examples', examples: [{ arabic: 'كتبوا الدرس', english: 'They wrote the lesson.', note: 'Today' }] }],
    },
    {
      moduleId: 'sessions',
      title: 'Heard in',
      blocks: [{ kind: 'list', items: [{ text: '7 Nov 2026, 10:00', note: 'heard 3 times' }] }],
    },
  ],
};

async function liveViewWith(details: WordDetails[] = [kataba]) {
  const user = userEvent.setup();
  const bridge = new FakeBridge();
  details.forEach((d) => bridge.details.set(d.lemmaId, d));
  const demo = new ManualDemoFeed();
  renderApp({ bridge, demo });
  await user.click(await screen.findByRole('button', { name: 'Start Demo Session' }));
  act(() => demo.emit(final('u1', [['كتبوا', 'they wrote', 7], ['الدرس', 'the lesson', 8]])));
  return { user, bridge, demo };
}

const panel = () => screen.getByRole('complementary', { name: 'Word details' });

describe('Click-a-word panel', () => {
  it('opens from a word in the Live View with its Detail Module sections in order', async () => {
    const { user, bridge } = await liveViewWith();

    await user.click(screen.getByRole('button', { name: 'Show details for كتبوا' }));

    expect(bridge.detailRequests).toEqual([{ lemmaId: 7, surface: 'كتبوا' }]);
    const sections = await within(panel()).findAllByRole('region');
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual([
      'Form',
      'Definitions',
      'Your examples',
      'Heard in',
    ]);
    expect(within(panel()).getByRole('heading', { level: 2 }).textContent).toBe('كتبوا');
    expect(within(panel()).getByText('they wrote')).toBeTruthy();
    expect(within(sections[0]).getByText('ك.ت.ب').getAttribute('dir')).toBe('rtl');
    expect(within(sections[1]).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['to write', 'to compose']);
    expect(within(sections[1]).getByText('From the root ك ت ب.')).toBeTruthy();
    expect(within(sections[2]).getByText('They wrote the lesson.')).toBeTruthy();
    expect(within(sections[3]).getByRole('listitem').textContent).toBe('7 Nov 2026, 10:00 · heard 3 times');
  });

  it('marks the word whose panel is open, and switches when another is clicked', async () => {
    const { user, bridge } = await liveViewWith();
    const first = screen.getByRole('button', { name: 'Show details for كتبوا' });
    const second = screen.getByRole('button', { name: 'Show details for الدرس' });

    await user.click(first);
    expect(first.getAttribute('aria-pressed')).toBe('true');
    await user.click(second);

    expect(first.getAttribute('aria-pressed')).toBe('false');
    expect(second.getAttribute('aria-pressed')).toBe('true');
    expect(bridge.detailRequests.at(-1)).toEqual({ lemmaId: 8, surface: 'الدرس' });
    // Lemma 8 is not in the fake Vocabulary.
    expect(await within(panel()).findByText('No details for this word yet.')).toBeTruthy();
  });

  it('closes with its close button or Escape', async () => {
    const { user } = await liveViewWith();

    await user.click(screen.getByRole('button', { name: 'Show details for كتبوا' }));
    await user.click(within(panel()).getByRole('button', { name: 'Close word details' }));
    expect(screen.queryByRole('complementary', { name: 'Word details' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Show details for كتبوا' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Word details' })).toBeNull();
  });

  it('opens for a word not analyzed yet, and fills in once its Lemma arrives', async () => {
    const { user, bridge, demo } = await liveViewWith();
    act(() => demo.emit(final('u2', [['كتبوا', '', null], ['الدرس', 'the lesson', 8]])));
    const words = screen.getAllByRole('button', { name: 'Show details for كتبوا' });

    await user.click(words[1]);
    expect(within(panel()).getByText('Details appear once this word has been analyzed.')).toBeTruthy();
    expect(bridge.detailRequests).toEqual([]);

    act(() => demo.emit(final('u2', [['كتبوا', 'they wrote', 7], ['الدرس', 'the lesson', 8]])));
    expect(await within(panel()).findByRole('region', { name: 'Form' })).toBeTruthy();
  });

  it('says so when the details cannot be loaded', async () => {
    const { user, bridge } = await liveViewWith();
    bridge.detailsError = new Error('main process gone');

    await user.click(screen.getByRole('button', { name: 'Show details for كتبوا' }));

    expect(await within(panel()).findByText('Could not load this word’s details: main process gone')).toBeTruthy();
  });

  it('leaves out a section that cannot be shown, keeping the rest', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken: WordDetails = {
      ...kataba,
      sections: [
        kataba.sections[0],
        // A malformed section, as a buggy module might send.
        { moduleId: 'broken', title: 'Broken', blocks: [{ kind: 'facts', facts: null as never }] },
        { moduleId: 'future', title: 'Future', blocks: [{ kind: 'chart' } as never] },
        kataba.sections[3],
      ],
    };
    const { user } = await liveViewWith([broken]);

    await user.click(screen.getByRole('button', { name: 'Show details for كتبوا' }));

    const sections = await within(panel()).findAllByRole('region');
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual(['Form', 'Future', 'Heard in']);
  });
});
