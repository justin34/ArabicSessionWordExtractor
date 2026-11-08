// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Utterance } from '../../src/core/types';
import { FakeBridge, FakeMicRecordingGate, renderApp, session } from './harness';

/** "Transcribe my microphone" (#45) on a completed Session's header. */

afterEach(cleanup);

const utterance = (id: number, text: string, startMs: number, track: 'desktop' | 'mic', translation: string): Utterance => ({
  id,
  sessionId: 1,
  text,
  translation,
  startMs,
  endMs: startMs + 1000,
  tokens: text.split(' ').map((surface, i) => ({ surface, gloss: '', lemmaId: null, startMs: startMs + i * 300, endMs: startMs + i * 300 + 250 })),
  track,
});

const TEACHER = utterance(1, 'مرحبا بكم', 0, 'desktop', 'Welcome');
const LEARNER = utterance(2, 'شكرا جزيلا', 2000, 'mic', 'Thank you very much');

function bridgeWith({ mic = true, transcript = [TEACHER] }: { mic?: boolean; transcript?: Utterance[] } = {}) {
  const bridge = new FakeBridge([session({ id: 1, micTrackPath: mic ? 'session-1-mic.webm' : null })]);
  bridge.transcripts.set(1, transcript);
  return bridge;
}

async function openSession(bridge: FakeBridge, micGate?: FakeMicRecordingGate) {
  const user = userEvent.setup();
  const view = renderApp({ bridge, micGate });
  await user.click(await screen.findByRole('button', { name: /open session/i }));
  await screen.findByText('Welcome');
  return { user, ...view };
}

const button = () => screen.queryByRole('button', { name: 'Transcribe my microphone' });

describe('Transcribe my microphone', () => {
  it('is offered only for a Session with a Mic Track and no Learner Utterances', async () => {
    await openSession(bridgeWith());
    expect(button()).toBeTruthy();
    cleanup();

    await openSession(bridgeWith({ mic: false }));
    expect(button()).toBeNull();
    cleanup();

    await openSession(bridgeWith({ transcript: [TEACHER, LEARNER] }));
    expect(button()).toBeNull();
  });

  it('starts the job in the main process, shows its progress, then shows the Learner Utterances without the button', async () => {
    const bridge = bridgeWith();
    const { user } = await openSession(bridge);
    await user.click(button()!);

    expect(bridge.micTranscriptionStarts).toEqual([{ sessionId: 1, gated: false }]);
    expect((await screen.findByRole('status')).textContent).toMatch(/Transcribing your speech/);
    expect(button()).toBeNull();

    act(() => bridge.reportMicTranscription(1, { state: 'running', note: 'Translating your speech…' }));
    expect(screen.getByRole('status').textContent).toBe('Translating your speech…');

    bridge.transcripts.set(1, [TEACHER, LEARNER]);
    act(() => bridge.reportMicTranscription(1, { state: 'done' }));

    // Shown per the Replay setting (Together): the learner's sentence on Replay.
    expect(await screen.findByText('Thank you very much')).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Show my speech' })).toBeTruthy();
    expect(button()).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps the button after a failure, saying why', async () => {
    const bridge = bridgeWith();
    const { user } = await openSession(bridge);
    await user.click(button()!);
    act(() => bridge.reportMicTranscription(1, { state: 'failed', message: 'Soniox refused the API key. Check it in Settings.' }));

    expect(screen.getByRole('alert').textContent).toMatch(/Could not transcribe your speech: Soniox refused the API key/);
    expect(button()).toBeTruthy();
  });

  it('says why when the job cannot start', async () => {
    const bridge = bridgeWith();
    bridge.micTranscriptionError = new Error('The Session has no recorded microphone.');
    const { user } = await openSession(bridge);
    await user.click(button()!);

    expect((await screen.findByRole('alert')).textContent).toMatch(/no recorded microphone/);
    expect(button()).toBeTruthy();
  });

  it('with the mic threshold set, gates the stored Mic Track first and sends that copy', async () => {
    const bridge = bridgeWith();
    bridge.audio = { desktopSource: null, microphone: null, micThreshold: 0.3 };
    const micGate = new FakeMicRecordingGate();
    const { user } = await openSession(bridge, micGate);
    await user.click(button()!);

    await waitFor(() => expect(bridge.micTranscriptionStarts).toEqual([{ sessionId: 1, gated: true }]));
    expect(micGate.calls).toEqual([{ url: 'session-audio://mic/1', threshold: 0.3 }]);
    expect(bridge.gatedMicRecordings.get(1)).toEqual(micGate.chunks);
  });

  it('a gate that fails says why and sends nothing', async () => {
    const bridge = bridgeWith();
    bridge.audio = { desktopSource: null, microphone: null, micThreshold: 0.3 };
    const micGate = new FakeMicRecordingGate();
    micGate.error = new Error('Could not decode the recorded microphone to apply the mic threshold.');
    const { user } = await openSession(bridge, micGate);
    await user.click(button()!);

    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not decode/);
    expect(bridge.micTranscriptionStarts).toEqual([]);
    expect(button()).toBeTruthy();
  });

  it('carries on while the learner is elsewhere, and shows a job already running on reopening', async () => {
    const bridge = bridgeWith();
    const { user } = await openSession(bridge);
    await user.click(button()!);
    await user.click(screen.getByRole('button', { name: /Back to Sessions/ }));

    bridge.transcripts.set(1, [TEACHER, LEARNER]);
    act(() => bridge.reportMicTranscription(1, { state: 'done' }));
    await user.click(await screen.findByRole('button', { name: /open session/i }));
    expect(await screen.findByText('Thank you very much')).toBeTruthy();
    expect(button()).toBeNull();
    cleanup();

    // A window opened while it runs (e.g. reloaded) asks the main process.
    const reopened = bridgeWith();
    reopened.micTranscriptionStatuses.set(1, { state: 'running', note: 'Transcribing your speech… you can leave this screen.' });
    await openSession(reopened);
    expect((await screen.findByRole('status')).textContent).toMatch(/Transcribing your speech/);
    expect(button()).toBeNull();
  });
});
