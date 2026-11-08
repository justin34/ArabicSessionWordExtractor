// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Utterance, WordDetails } from '../../src/core/types';
import { FakeBridge, renderApp, session } from './harness';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const utterance = (
  id: number,
  startMs: number,
  words: Array<[string, string, number | null]>,
  translation: string,
): Utterance => ({
  id,
  sessionId: 1,
  text: words.map(([w]) => w).join(' '),
  translation,
  startMs,
  endMs: startMs + words.length * 500,
  tokens: words.map(([surface, gloss, lemmaId], i) => ({
    surface,
    gloss,
    lemmaId,
    startMs: startMs + i * 500,
    endMs: startMs + i * 500 + 400,
  })),
  track: 'desktop',
});

const transcript: Utterance[] = [
  utterance(10, 0, [['مرحبا', 'hello', 1], ['بكم', 'with you', 2]], 'Welcome'),
  utterance(11, 2000, [['كتبوا', 'they wrote', 3], ['الدرس', 'the lesson', 4], ['iPhone', '', null]], 'They wrote the lesson.'),
  // Analysis failed: no glosses, no Lemmas. Replay still shows its words.
  utterance(12, 5000, [['شكرا', '', null]], ''),
];

const kataba: WordDetails = {
  lemmaId: 3,
  lemma: 'كَتَب',
  sections: [{ moduleId: 'form', title: 'Form', blocks: [{ kind: 'facts', facts: [{ label: 'Root', value: 'ك.ت.ب', arabic: true }] }] }],
};

/** Stands in for the browser's media element, which jsdom does not play. */
function fakePlayer(audio: HTMLAudioElement) {
  let time = 0;
  let paused = true;
  Object.defineProperty(audio, 'currentTime', {
    configurable: true,
    get: () => time,
    set: (t: number) => {
      time = t;
      audio.dispatchEvent(new Event('seeked'));
    },
  });
  Object.defineProperty(audio, 'paused', { configurable: true, get: () => paused });
  audio.play = vi.fn(async () => {
    paused = false;
    audio.dispatchEvent(new Event('play'));
  });
  audio.pause = vi.fn(() => {
    paused = true;
    audio.dispatchEvent(new Event('pause'));
  });
  return {
    get time() {
      return time;
    },
    /** Playback reaching a position. */
    reach(ms: number) {
      time = ms / 1000;
      act(() => {
        fireEvent.timeUpdate(audio);
      });
    },
  };
}

async function openReplay(bridge = bridgeWithTranscript()) {
  const user = userEvent.setup();
  const view = renderApp({ bridge });
  await user.click(await screen.findByRole('button', { name: /open session/i }));
  await screen.findByText('Welcome');
  const audio = view.container.querySelector('audio')!;
  return { user, bridge, audio, player: fakePlayer(audio) };
}

function bridgeWithTranscript(): FakeBridge {
  const bridge = new FakeBridge([session({ id: 1 })]);
  bridge.transcripts.set(1, transcript);
  bridge.details.set(3, kataba);
  return bridge;
}

const sentences = () => screen.getAllByRole('article');
const currentWord = () => {
  const words = screen.getByRole('region', { name: 'Transcript' }).querySelectorAll('[role="group"][aria-current="true"]');
  return [...words].map((w) => w.querySelector('.word__ar')!.textContent);
};

describe('Replay View', () => {
  it("shows a completed Session's whole Transcript, word by word with glosses and translations", async () => {
    const { bridge, audio } = await openReplay();

    expect(bridge.calls).toContain('transcript:1');
    expect(audio.getAttribute('src')).toBe('session-audio://desktop/1');
    expect(sentences()).toHaveLength(3);
    const second = within(sentences()[1]);
    expect(second.getByText('they wrote')).toBeTruthy();
    expect(second.getByText('They wrote the lesson.')).toBeTruthy();
    expect(second.getByRole('button', { name: 'Play from 0:02' })).toBeTruthy();
    // Words of an unanalyzed sentence still show, so Replay can highlight them.
    expect(within(sentences()[2]).getByRole('button', { name: 'Show details for شكرا' })).toBeTruthy();
  });

  it('highlights the sentence and word at the playback position as it plays', async () => {
    const { player } = await openReplay();

    player.reach(100);
    expect(currentWord()).toEqual(['مرحبا']);
    expect(sentences()[0].getAttribute('aria-current')).toBe('true');

    player.reach(2600);
    expect(currentWord()).toEqual(['الدرس']);
    expect(sentences()[0].getAttribute('aria-current')).toBeNull();
    expect(sentences()[1].getAttribute('aria-current')).toBe('true');

    // A Foreign word is highlighted too.
    player.reach(3100);
    expect(currentWord()).toEqual(['iPhone']);

    // Between sentences nothing is lit.
    player.reach(4500);
    expect(currentWord()).toEqual([]);
    expect(sentences().some((s) => s.getAttribute('aria-current'))).toBe(false);
    expect(screen.getByText('0:04 / 5:00')).toBeTruthy();
  });

  it('seeks to a sentence and plays from there when it is clicked', async () => {
    const { user, audio, player } = await openReplay();

    await user.click(within(sentences()[1]).getByText('They wrote the lesson.'));
    expect(player.time).toBe(2);
    expect(audio.play).toHaveBeenCalled();
    expect(currentWord()).toEqual(['كتبوا']);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();

    await user.click(within(sentences()[0]).getByRole('button', { name: 'Play from 0:00' }));
    expect(player.time).toBe(0);
    expect(currentWord()).toEqual(['مرحبا']);
  });

  it('plays, pauses and seeks from the controls', async () => {
    const { user, audio, player } = await openReplay();

    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(audio.play).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(audio.pause).toHaveBeenCalled();

    fireEvent.change(screen.getByRole('slider', { name: 'Playback position' }), { target: { value: '5000' } });
    expect(player.time).toBe(5);
    expect(currentWord()).toEqual(['شكرا']);
  });

  it('opens the word panel when a word is clicked, without seeking', async () => {
    const { user, bridge, player } = await openReplay();

    await user.click(screen.getByRole('button', { name: 'Show details for كتبوا' }));

    const panel = await screen.findByRole('complementary', { name: 'Word details' });
    expect(await within(panel).findByText('ك.ت.ب')).toBeTruthy();
    expect(bridge.detailRequests).toEqual([{ lemmaId: 3, surface: 'كتبوا' }]);
    expect(player.time).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Show details for شكرا' }));
    expect(within(panel).getByText(/was not analyzed/)).toBeTruthy();
  });

  it('keeps playing behind the Session Guide tab', async () => {
    const { user, audio, player } = await openReplay();
    await user.click(screen.getByRole('button', { name: 'Play' }));

    await user.click(screen.getByRole('tab', { name: 'Session Guide' }));
    expect(screen.getByRole('tabpanel', { name: 'Session Guide' })).toBeTruthy();
    expect(audio.isConnected).toBe(true);
    expect(audio.pause).not.toHaveBeenCalled();

    await user.click(screen.getByRole('tab', { name: 'Replay' }));
    player.reach(650);
    expect(currentWord()).toEqual(['بكم']);
  });

  it('says when the audio cannot be played or the Transcript is empty or cannot load', async () => {
    const { audio } = await openReplay();
    fireEvent.error(audio);
    expect(screen.getByText(/audio can’t be played/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play' }).hasAttribute('disabled')).toBe(true);
    cleanup();

    const user = userEvent.setup();
    renderApp({ bridge: new FakeBridge([session({ id: 1 })]) });
    await user.click(await screen.findByRole('button', { name: /open session/i }));
    expect(await screen.findByText('No Transcript')).toBeTruthy();
    cleanup();

    const failing = new FakeBridge([session({ id: 1 })]);
    failing.transcriptError = new Error('database closed');
    renderApp({ bridge: failing });
    await user.click(await screen.findByRole('button', { name: /open session/i }));
    expect(await screen.findByText('Could not load the Transcript')).toBeTruthy();
    expect(screen.getByText('database closed')).toBeTruthy();
  });
});

describe('Replay with a Mic Track', () => {
  async function openWithMic() {
    const bridge = new FakeBridge([session({ id: 1, micTrackPath: 'session-1-mic.webm' })]);
    bridge.transcripts.set(1, transcript);
    const user = userEvent.setup();
    const view = renderApp({ bridge });
    await user.click(await screen.findByRole('button', { name: /open session/i }));
    await screen.findByText('Welcome');
    const desktop = view.container.querySelector<HTMLAudioElement>('audio[data-track="desktop"]')!;
    const mic = view.container.querySelector<HTMLAudioElement>('audio[data-track="mic"]')!;
    return { user, desktop, mic, desktopPlayer: fakePlayer(desktop), micPlayer: fakePlayer(mic) };
  }

  it('plays only the Desktop Track for a Session without one', async () => {
    const { audio } = await openReplay();
    expect(audio.getAttribute('data-track')).toBe('desktop');
    expect(document.querySelector('audio[data-track="mic"]')).toBeNull();
  });

  it('plays, pauses and seeks the Mic Track together with the Desktop Track', async () => {
    const { user, desktop, mic, micPlayer } = await openWithMic();
    expect(mic.getAttribute('src')).toBe('session-audio://mic/1');

    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(desktop.play).toHaveBeenCalled();
    expect(mic.play).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(mic.pause).toHaveBeenCalled();

    fireEvent.change(screen.getByRole('slider', { name: 'Playback position' }), { target: { value: '5000' } });
    expect(micPlayer.time).toBe(5);

    await user.click(within(sentences()[1]).getByText('They wrote the lesson.'));
    expect(micPlayer.time).toBe(2);
    expect(mic.play).toHaveBeenCalledTimes(2);
  });

  it('moves the Mic Track back in step when it drifts while playing', async () => {
    const { user, desktopPlayer, micPlayer } = await openWithMic();
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    await user.click(screen.getByRole('button', { name: 'Play' }));

    desktopPlayer.reach(3000);
    act(() => frames.at(-1)!(0));
    expect(micPlayer.time).toBe(3);

    // A small drift is left alone.
    micPlayer.reach(3100);
    act(() => frames.at(-1)!(0));
    expect(micPlayer.time).toBeCloseTo(3.1);
  });

  it('keeps playing the desktop audio when the Mic Track cannot be played', async () => {
    const { user, desktop, mic } = await openWithMic();
    fireEvent.error(mic);
    expect(screen.getByText(/microphone track can’t be played/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(desktop.play).toHaveBeenCalled();
    expect(mic.play).not.toHaveBeenCalled();
  });
});

