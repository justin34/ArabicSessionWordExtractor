// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LiveUtterance } from '../../src/renderer/bridge';
import { FakeBridge, renderApp } from './harness';

/** "Also transcribe my speech" and Learner Utterances in Live View (GLOSSARY; ADR 0004). */

afterEach(cleanup);

const words = (text: string, startMs: number) =>
  text.split(' ').map((surface, i) => ({ surface, gloss: '', startMs: startMs + i * 400, endMs: startMs + i * 400 + 350, lemmaId: null }));

const teacher = (id: string, text: string, startMs: number, translation: string, gloss = 'gloss'): LiveUtterance => ({
  id,
  isFinal: true,
  text,
  translation,
  tokens: words(text, startMs).map((t) => ({ ...t, gloss, lemmaId: 1 })),
  startMs,
});

const learner = (id: string, text: string, startMs: number, translation: string, isFinal = true): LiveUtterance => ({
  id,
  isFinal,
  text,
  translation,
  tokens: isFinal ? words(text, startMs) : [],
  track: 'mic',
  startMs,
});

function withSpeechKey() {
  const bridge = new FakeBridge();
  bridge.keys.set('soniox', 'sk-test-1234');
  return bridge;
}

async function openStartPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Start Session' }));
  return screen.getByRole('dialog');
}

const transcribeBox = () => screen.getByRole('checkbox', { name: 'Also transcribe my speech' }) as HTMLInputElement;

describe('Also transcribe my speech', () => {
  it('is nested under the mic option, unticked, and only on once the mic is ticked', async () => {
    const user = userEvent.setup();
    renderApp({ bridge: withSpeechKey() });
    const dialog = await openStartPanel(user);
    await screen.findByText(/All system audio/);

    expect(transcribeBox().checked).toBe(false);
    expect(transcribeBox().disabled).toBe(true);
    expect(dialog.textContent).toMatch(/never added to your vocabulary/);
    expect(dialog.textContent).toMatch(/roughly doubles/);

    await user.click(screen.getByRole('checkbox', { name: 'Also record my microphone' }));
    expect(transcribeBox().disabled).toBe(false);
    await user.click(transcribeBox());
    expect(transcribeBox().checked).toBe(true);

    // Unticking the mic turns it off again.
    await user.click(screen.getByRole('checkbox', { name: 'Also record my microphone' }));
    expect(transcribeBox().checked).toBe(false);
    expect(transcribeBox().disabled).toBe(true);
  });

  it('is disabled without a speech-to-text key', async () => {
    const user = userEvent.setup();
    renderApp();
    await openStartPanel(user);
    await screen.findByText(/No speech-to-text key/);
    await user.click(screen.getByRole('checkbox', { name: 'Also record my microphone' }));

    expect(transcribeBox().disabled).toBe(true);
  });

  it('starts a Session that transcribes the Mic Track; leaving it unticked starts one as before', async () => {
    const user = userEvent.setup();
    const { bridge, mic } = renderApp({ bridge: withSpeechKey() });
    await openStartPanel(user);
    await screen.findByText(/All system audio/);
    await user.click(screen.getByRole('checkbox', { name: 'Also record my microphone' }));
    await user.click(transcribeBox());
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByRole('button', { name: 'Stop' });

    expect(bridge.startOptions).toEqual([{ mic: true, transcribeMic: true }]);
    expect(mic.opened).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await openStartPanel(user);
    await screen.findByText(/All system audio/);
    await user.click(screen.getByRole('checkbox', { name: 'Also record my microphone' }));
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByRole('button', { name: 'Stop' });
    expect(bridge.startOptions[1]).toEqual({ mic: true });
  });
});

describe('Learner Utterances in Live View', () => {
  async function recording() {
    const user = userEvent.setup();
    const view = renderApp({ bridge: withSpeechKey() });
    await openStartPanel(user);
    await screen.findByText(/All system audio/);
    await user.click(screen.getByRole('checkbox', { name: 'Also record my microphone' }));
    await user.click(transcribeBox());
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByRole('button', { name: 'Stop' });
    return { user, ...view };
  }

  it('are marked "You", translated, unglossed and unclickable, interleaved with the teacher by start', async () => {
    const { bridge } = await recording();

    act(() => bridge.emit(1, teacher('0', 'مرحبا بكم', 0, 'Welcome.')));
    act(() => bridge.emit(1, teacher('1', 'كيف حالك', 5000, 'How are you?')));
    // The learner's reply started before the teacher's second sentence, but arrives after it.
    act(() => bridge.emit(1, learner('mic-0', 'أهلا', 3000, 'Hello.')));

    const articles = screen.getAllByRole('article');
    expect(articles.map((a) => a.textContent)).toEqual([
      expect.stringContaining('Welcome.'),
      expect.stringContaining('Hello.'),
      expect.stringContaining('How are you?'),
    ]);
    const mine = articles[1];
    expect(mine.getAttribute('data-track')).toBe('mic');
    expect(mine.className).toMatch(/utterance--learner/);
    expect(within(mine).getByText('You')).toBeTruthy();
    expect(within(mine).getByText('أهلا')).toBeTruthy();
    expect(within(mine).queryAllByRole('button')).toHaveLength(0);
    expect(mine.querySelector('.word__gloss')).toBeNull();
    // The teacher's words are still clickable, and not marked as the learner's.
    expect(within(articles[0]).queryByText('You')).toBeNull();
    expect(within(articles[0]).getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('show interim learner speech muted and marked, replaced by its final form', async () => {
    const { bridge } = await recording();

    act(() => bridge.emit(1, learner('mic-0', 'أهلا', 1000, '', false)));
    const interim = screen.getByRole('article');
    expect(interim.getAttribute('data-state')).toBe('interim');
    expect(within(interim).getByText('You')).toBeTruthy();

    act(() => bridge.emit(1, learner('mic-0', 'أهلا وسهلا', 1000, 'Welcome.')));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article').getAttribute('data-state')).toBe('final');
    expect(screen.getByText('Welcome.')).toBeTruthy();
  });

  it('say only mic transcription stopped when the mic stream fails', async () => {
    const { bridge } = await recording();

    act(() => bridge.failTranscription(1, 'Soniox error 503', 'mic'));
    const warning = await screen.findByText(/Transcription of your microphone has stopped/);
    expect(warning.parentElement!.textContent).toMatch(/Soniox error 503/);
    expect(screen.queryByText(/Transcription has stopped; the audio is still recording/)).toBeNull();

    // The teacher's Transcript carries on.
    act(() => bridge.emit(1, teacher('0', 'مرحبا', 0, 'Hello.')));
    expect(screen.getByText('Hello.')).toBeTruthy();
  });

  it('show a mic failure that came before Live View subscribed', async () => {
    const bridge = withSpeechKey();
    bridge.micFailures.set(1, 'No microphone stream');
    const user = userEvent.setup();
    renderApp({ bridge });
    await openStartPanel(user);
    await screen.findByText(/All system audio/);
    await user.click(screen.getByRole('checkbox', { name: 'Also record my microphone' }));
    await user.click(transcribeBox());
    await user.click(screen.getByRole('button', { name: 'Start' }));

    expect(await screen.findByText(/Transcription of your microphone has stopped/)).toBeTruthy();
  });
});
