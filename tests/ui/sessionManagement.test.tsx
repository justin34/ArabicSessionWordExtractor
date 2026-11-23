// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FakeBridge, FakeRecordingProbe, ManualDemoFeed, renderApp, session } from './harness';

afterEach(cleanup);

const started = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const START = '2026-01-02T09:00:00.000Z';

/** A bridge with a speech-to-text key, so "Import recording" is enabled. */
function keyed(bridge = new FakeBridge()) {
  bridge.keys.set('soniox', 'soniox-key-1234');
  return bridge;
}

async function rows() {
  return within(await screen.findByRole('list', { name: 'Session list' })).getAllByRole('listitem');
}

describe('Session names', () => {
  it('shows a named Session by its name, with the date as a second line', async () => {
    renderApp({ bridge: new FakeBridge([session({ id: 1, startedAt: START, name: 'الدرس الرابع' })]) });
    const [row] = await rows();
    expect(within(row).getByRole('button', { name: 'الدرس الرابع' }).getAttribute('dir')).toBe('auto');
    expect(within(row).getByText(started(START))).toBeTruthy();
  });

  it('names a Session from its row: the pencil, a name, Enter', async () => {
    const user = userEvent.setup();
    const { bridge } = renderApp({ bridge: new FakeBridge([session({ id: 1, startedAt: START })]) });
    const [row] = await rows();

    await user.click(within(row).getByRole('button', { name: 'Name this session' }));
    await user.type(within(row).getByRole('textbox', { name: 'Session name' }), 'Lesson 4{Enter}');

    expect(bridge.renames).toEqual([{ sessionId: 1, name: 'Lesson 4' }]);
    expect(await within(row).findByRole('button', { name: 'Lesson 4' })).toBeTruthy();
    expect(within(row).getByText(started(START))).toBeTruthy();
    // Editing the name did not open the Session.
    expect(screen.getByRole('heading', { name: 'Sessions' })).toBeTruthy();
  });

  it('renames by clicking the name; Esc cancels; clearing it goes back to the date', async () => {
    const user = userEvent.setup();
    const { bridge } = renderApp({ bridge: new FakeBridge([session({ id: 1, startedAt: START, name: 'Lesson 4' })]) });
    const [row] = await rows();

    await user.click(within(row).getByRole('button', { name: 'Lesson 4' }));
    const field = within(row).getByRole('textbox', { name: 'Session name' }) as HTMLInputElement;
    expect(field.value).toBe('Lesson 4');
    expect(field.maxLength).toBe(100);
    await user.type(field, ' draft{Escape}');
    expect(bridge.renames).toEqual([]);
    expect(within(row).getByRole('button', { name: 'Lesson 4' })).toBeTruthy();

    await user.click(within(row).getByRole('button', { name: 'Rename Lesson 4' }));
    await user.clear(within(row).getByRole('textbox', { name: 'Session name' }));
    await user.tab();
    expect(bridge.renames).toEqual([{ sessionId: 1, name: null }]);
    expect(await within(row).findByText(started(START))).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Lesson 4' })).toBeNull();
  });

  it('renames from the completed Session header', async () => {
    const user = userEvent.setup();
    const { bridge } = renderApp({ bridge: new FakeBridge([session({ id: 1, startedAt: START })]) });
    await user.click(await screen.findByRole('button', { name: /open session/i }));

    await user.click(screen.getByRole('button', { name: started(START) }));
    await user.type(screen.getByRole('textbox', { name: 'Session name' }), 'Lesson 4{Enter}');
    expect(bridge.renames).toEqual([{ sessionId: 1, name: 'Lesson 4' }]);
    expect(await screen.findByRole('heading', { name: /Lesson 4/ })).toBeTruthy();
    expect(screen.getByText(started(START))).toBeTruthy();
  });

  it('offers no renaming while a Session records, nor for a Demo Session', async () => {
    const user = userEvent.setup();
    const demo = new ManualDemoFeed();
    renderApp({ bridge: new FakeBridge([session({ id: 1, status: 'recording', endedAt: null })]), demo });
    const [row] = await rows();
    expect(within(row).queryByRole('button', { name: 'Name this session' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Start Demo Session' }));
    await user.click(screen.getByRole('button', { name: /back/i }));
    for (const r of await rows()) expect(within(r).queryByRole('button', { name: /name this session|remove session/i })).toBeNull();
  });
});

describe('Import a recording', () => {
  it('picks a file, asks for its name (the file name, all selected), and imports it', async () => {
    const user = userEvent.setup();
    const probe = new FakeRecordingProbe(125_000);
    const { bridge } = renderApp({ bridge: keyed(), probe });

    await user.click(await screen.findByRole('button', { name: 'Import recording' }));
    const dialog = await screen.findByRole('dialog', { name: 'Import a recording' });
    const name = within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    expect(name.value).toBe('Lesson 4');
    expect([name.selectionStart, name.selectionEnd]).toEqual([0, 'Lesson 4'.length]);
    await user.keyboard('Lesson 5');
    await user.click(within(dialog).getByRole('button', { name: 'Import' }));

    expect(bridge.imported).toEqual([{ token: 'tok-1', name: 'Lesson 5', durationMs: 125_000 }]);
    expect(probe.urls).toEqual(['session-audio://import/tok-1']);
    const [row] = await rows();
    expect(within(row).getByText('Importing')).toBeTruthy();
    expect(await within(row).findByText('Copying the recording…')).toBeTruthy();
  });

  it('shows how the import is going, and the Imported badge once it is done', async () => {
    const user = userEvent.setup();
    const { bridge } = renderApp({ bridge: keyed() });
    await user.click(await screen.findByRole('button', { name: 'Import recording' }));
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    const [row] = await rows();

    act(() => bridge.reportImport(1, { state: 'running', note: 'Translating 12 of 80' }));
    expect(within(row).getByText('Translating 12 of 80')).toBeTruthy();
    // An importing row does not open.
    await user.click(within(row).getByText('Lesson 4'));
    expect(screen.getByRole('heading', { name: 'Sessions' })).toBeTruthy();

    act(() => bridge.reportImport(1, { state: 'done' }));
    const [done] = await rows();
    expect(await within(done).findByText('Imported')).toBeTruthy();
    expect(within(done).getByText('Completed')).toBeTruthy();
  });

  it('Cancel on an importing row abandons it, without asking', async () => {
    const user = userEvent.setup();
    const { bridge } = renderApp({ bridge: keyed() });
    await user.click(await screen.findByRole('button', { name: 'Import recording' }));
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    const [row] = await rows();

    await user.click(within(row).getByRole('button', { name: 'Cancel importing Lesson 4' }));
    expect(bridge.cancelledImports).toEqual([1]);
    expect(await screen.findByText(/no sessions yet/i)).toBeTruthy();
  });

  it('says why an import failed', async () => {
    const user = userEvent.setup();
    const { bridge } = renderApp({ bridge: keyed() });
    await user.click(await screen.findByRole('button', { name: 'Import recording' }));
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    await rows();

    act(() => bridge.reportImport(1, { state: 'failed', message: 'Soniox refused the API key.', name: 'Lesson 4' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not import “Lesson 4”: Soniox refused the API key.');
    expect(await screen.findByText(/no sessions yet/i)).toBeTruthy();
  });

  it('refuses a file it cannot import, naming the formats it accepts', async () => {
    const user = userEvent.setup();
    const bridge = keyed();
    bridge.pickError = new Error('That file cannot be imported. Choose an mp3, m4a, aac, wav, ogg, opus, webm or mp4 file.');
    renderApp({ bridge });
    await user.click(await screen.findByRole('button', { name: 'Import recording' }));
    expect((await screen.findByRole('alert')).textContent).toContain('mp3, m4a, aac, wav, ogg, opus, webm or mp4');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is disabled without a speech-to-text key, with a way to Settings; a translation key is not needed', async () => {
    const user = userEvent.setup();
    const bridge = new FakeBridge();
    renderApp({ bridge });
    const button = await screen.findByRole('button', { name: 'Import recording' });
    await screen.findByText(/needs a speech-to-text key/);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Add one in Settings' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
  });

  it('is enabled with a Deepgram key alone, and disabled while another import runs', async () => {
    const user = userEvent.setup();
    const bridge = new FakeBridge();
    bridge.keys.set('deepgram', 'dg-key-1234');
    renderApp({ bridge });
    const button = (await screen.findByRole('button', { name: 'Import recording' })) as HTMLButtonElement;
    await act(async () => undefined);
    expect(button.disabled).toBe(false);
    await user.click(button);
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    await rows();
    expect((screen.getByRole('button', { name: 'Import recording' }) as HTMLButtonElement).disabled).toBe(true);
    // Recording can still start meanwhile.
    expect((screen.getByRole('button', { name: 'Start Session' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('Remove a Session', () => {
  function withWords() {
    const bridge = new FakeBridge([session({ id: 1, startedAt: START, name: 'Lesson 4' })]);
    bridge.removalPreviews.set(1, {
      words: [
        { lemmaId: 7, lemma: 'قَلَم', gloss: 'pen', ignored: false },
        { lemmaId: 8, lemma: 'زوم', gloss: 'Zoom', ignored: true },
      ],
    });
    return bridge;
  }

  it('asks first from the row, Cancel focused, listing the words that will leave the Vocabulary', async () => {
    const user = userEvent.setup();
    const { bridge } = renderApp({ bridge: withWords() });
    const [row] = await rows();
    const trash = within(row).getByRole('button', { name: 'Remove session' });
    expect(trash.getAttribute('title')).toBe('Remove session');
    await user.click(trash);

    const dialog = await screen.findByRole('dialog', { name: /Remove “Lesson 4”/ });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(dialog.textContent).toContain('Its recording and transcript will be deleted.');
    const list = await within(dialog).findByRole('list', { name: /2 words heard only in this Session/ });
    const words = within(list).getAllByRole('listitem');
    expect(words.map((w) => w.textContent)).toEqual(['قَلَمpen', 'زومZoomIgnored']);
    expect(dialog.textContent).toContain('Words already imported into Anki stay there.');

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(bridge.removals).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('removes it, its words with it, and says so on the Session List', async () => {
    const user = userEvent.setup();
    const { bridge } = renderApp({ bridge: withWords() });
    const [row] = await rows();
    await user.click(within(row).getByRole('button', { name: 'Remove session' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('list');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    expect(bridge.removals).toEqual([{ sessionId: 1, keepWords: false }]);
    expect((await screen.findByRole('status', { name: 'Removed Session' })).textContent).toContain('Removed “Lesson 4”');
    expect(await screen.findByText(/no sessions yet/i)).toBeTruthy();
  });

  it('"Keep its words" hides the list and keeps the Vocabulary as it is', async () => {
    const user = userEvent.setup();
    const { bridge } = renderApp({ bridge: withWords() });
    const [row] = await rows();
    await user.click(within(row).getByRole('button', { name: 'Remove session' }));
    const dialog = await screen.findByRole('dialog');
    const keep = await within(dialog).findByRole('checkbox', { name: 'Keep its words in my Vocabulary' });
    expect((keep as HTMLInputElement).checked).toBe(false);
    await user.click(keep);
    expect(within(dialog).queryByRole('list')).toBeNull();
    expect(dialog.textContent).not.toContain('Anki');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(bridge.removals).toEqual([{ sessionId: 1, keepWords: true }]);
  });

  it('leaves out the checkbox and list when no word was heard only there; an unnamed one is named by its date', async () => {
    const user = userEvent.setup();
    renderApp({ bridge: new FakeBridge([session({ id: 1, startedAt: START })]) });
    const [row] = await rows();
    await user.click(within(row).getByRole('button', { name: 'Remove session' }));
    const dialog = await screen.findByRole('dialog', { name: /Remove the Session of/ });
    await act(async () => undefined);
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect(within(dialog).queryByRole('list')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect((await screen.findByRole('status', { name: 'Removed Session' })).textContent).toContain('Removed the Session of');
  });

  it('removes from the completed Session header, back to the Session List', async () => {
    const user = userEvent.setup();
    const { bridge } = renderApp({ bridge: withWords() });
    await user.click(await screen.findByRole('button', { name: /open session/i }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('list');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(bridge.removals).toEqual([{ sessionId: 1, keepWords: false }]);
    expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeTruthy();
    expect((await screen.findByRole('status', { name: 'Removed Session' })).textContent).toContain('Removed “Lesson 4”');
  });

  it('is not offered while recording or importing, nor while "Transcribe my microphone" runs', async () => {
    const user = userEvent.setup();
    const bridge = new FakeBridge([
      session({ id: 1, status: 'recording', endedAt: null, startedAt: '2026-01-03T10:00:00.000Z' }),
      session({ id: 2, status: 'importing', endedAt: null, name: 'Import', imported: true, startedAt: '2026-01-02T10:00:00.000Z' }),
      session({ id: 3, micTrackPath: 'session-3-mic.webm' }),
    ]);
    renderApp({ bridge });
    const [recording, importing, completed] = await rows();
    expect(within(recording).queryByRole('button', { name: 'Remove session' })).toBeNull();
    expect(within(importing).queryByRole('button', { name: 'Remove session' })).toBeNull();
    expect(within(completed).getByRole('button', { name: 'Remove session' })).toBeTruthy();

    await user.click(within(completed).getByRole('button', { name: /open session/i }));
    expect(await screen.findByRole('button', { name: 'Remove' })).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: 'Transcribe my microphone' }));
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });
});

describe('Vocabulary', () => {
  it('says when a word was first heard in a Removed Session', async () => {
    const user = userEvent.setup();
    const bridge = new FakeBridge();
    bridge.vocabulary = [
      {
        lemmaId: 1,
        lemma: 'كَتَب',
        root: null,
        partOfSpeech: 'verb',
        stemGloss: 'write',
        surfaceForms: ['كتب'],
        firstHeardAt: START,
        count: 2,
        heardIn: [{ sessionId: 1, utteranceId: null }],
        ignored: false,
        firstHeardInRemoved: true,
      },
    ];
    renderApp({ bridge });
    await user.click(await screen.findByRole('button', { name: 'Vocabulary' }));
    expect(await screen.findByText(`First heard ${started(START)} in a removed Session`)).toBeTruthy();
  });
});
