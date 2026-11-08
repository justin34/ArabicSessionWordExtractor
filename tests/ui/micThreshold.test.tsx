// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FakeAudioInputs, FakeBridge, FakeCapture, renderApp } from './harness';

/** The mic threshold (#44): Settings → Audio, the Start panel, and what a Session sends where. */

afterEach(cleanup);

const headset = { deviceId: 'headset', label: 'Headset Microphone' };
const webcam = { deviceId: 'webcam', label: 'Webcam Microphone' };

async function openSettings(opts: Parameters<typeof renderApp>[0] = {}) {
  const user = userEvent.setup();
  const view = renderApp({ inputs: new FakeAudioInputs([headset, webcam]), ...opts });
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  const slider = (await screen.findByRole('slider', { name: 'Mic threshold' })) as HTMLInputElement;
  return { ...view, user, slider };
}

const meterValue = () => Number(screen.getByRole('meter', { name: 'Microphone level' }).getAttribute('aria-valuenow'));

function withSpeechKey() {
  const bridge = new FakeBridge();
  bridge.keys.set('soniox', 'sk-test-1234');
  return bridge;
}

describe('Mic threshold in Settings', () => {
  it('is off by default, and saves each setting with the devices; 0 is off again', async () => {
    const { slider, bridge } = await openSettings();

    expect(slider.value).toBe('0');
    expect(slider.getAttribute('aria-valuetext')).toBe('Off');

    fireEvent.change(slider, { target: { value: '25' } });
    expect(await screen.findByText('25%')).toBeTruthy();
    expect(bridge.audio).toEqual({ desktopSource: null, microphone: null, micThreshold: 0.25 });

    fireEvent.change(slider, { target: { value: '0' } });
    await waitFor(() => expect(bridge.audio).toStrictEqual({ desktopSource: null, microphone: null }));
    expect(slider.getAttribute('aria-valuetext')).toBe('Off');
  });

  it('keeps the threshold when a device is chosen', async () => {
    const bridge = new FakeBridge();
    bridge.audio = { desktopSource: null, microphone: null, micThreshold: 0.4 };
    const { user, slider } = await openSettings({ bridge });

    expect(slider.value).toBe('40');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Microphone (Mic Track)' }), headset.label);
    expect(bridge.audio).toEqual({ desktopSource: null, microphone: headset, micThreshold: 0.4 });
  });

  it('has a level meter that moves live with the selected microphone, reopened when it changes', async () => {
    const mic = new FakeCapture();
    const { user } = await openSettings({ mic });

    await waitFor(() => expect(mic.opened).toBe(1));
    expect(mic.openedWith).toEqual([null]);
    // Metering records nothing, and is never gated.
    expect(mic.onChunk).toBeNull();
    expect(mic.thresholds).toEqual([undefined]);

    mic.levelValue = 0.6;
    await waitFor(() => expect(meterValue()).toBe(60));
    mic.levelValue = 0.1;
    await waitFor(() => expect(meterValue()).toBe(10));

    await user.selectOptions(screen.getByRole('combobox', { name: 'Microphone (Mic Track)' }), webcam.label);
    await waitFor(() => expect(mic.openedWith).toEqual([null, webcam]));
    expect(mic.stopped).toBe(1);

    // Leaving Settings lets the microphone go.
    await user.click(screen.getByRole('button', { name: 'Sessions' }));
    await waitFor(() => expect(mic.stopped).toBe(2));
  });

  it('says when the meter cannot open the microphone, and still saves the threshold', async () => {
    const mic = new FakeCapture();
    mic.openError = new Error('Permission denied');
    const { slider, bridge } = await openSettings({ mic });

    expect((await screen.findByRole('alert')).textContent).toMatch(/meter: Permission denied/);
    fireEvent.change(slider, { target: { value: '30' } });
    await waitFor(() => expect(bridge.audio.micThreshold).toBe(0.3));
  });
});

describe('A Session with the mic threshold', () => {
  async function start(bridge: FakeBridge, { transcribe }: { transcribe: boolean }) {
    const user = userEvent.setup();
    const view = renderApp({ bridge });
    await user.click(await screen.findByRole('button', { name: 'Start Session' }));
    await screen.findByText(/All system audio/);
    await user.click(screen.getByRole('checkbox', { name: 'Also record my microphone' }));
    if (transcribe) await user.click(screen.getByRole('checkbox', { name: 'Also transcribe my speech' }));
    const note = screen.getByText(/Saved as a separate track/).textContent;
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByRole('button', { name: 'Stop' });
    return { ...view, note };
  }

  it('is named on the Start panel, opens the mic gated, and sends only the gated audio to speech-to-text', async () => {
    const bridge = withSpeechKey();
    bridge.audio = { desktopSource: null, microphone: headset, micThreshold: 0.2 };
    const { mic, note } = await start(bridge, { transcribe: true });

    expect(note).toMatch(/From Headset Microphone, mic threshold 20%\./);
    expect(bridge.startOptions).toEqual([{ mic: true, transcribeMic: true, gateMic: true }]);
    expect(mic.thresholds).toEqual([0.2]);
    act(() => {
      mic.onChunk!(new Uint8Array([7]));
      mic.onGatedChunk!(new Uint8Array([0]));
    });
    // The recording keeps everything; only the gated copy reaches speech-to-text.
    await waitFor(() => expect(bridge.gatedMicChunks).toHaveLength(1));
    expect(bridge.micChunks.map((c) => [...c.chunk])).toEqual([[7]]);
    expect(bridge.gatedMicChunks.map((c) => [...c.chunk])).toEqual([[0]]);
  });

  it('is not applied when the mic is only recorded', async () => {
    const bridge = withSpeechKey();
    bridge.audio = { desktopSource: null, microphone: null, micThreshold: 0.2 };
    const { mic } = await start(bridge, { transcribe: false });

    expect(bridge.startOptions).toEqual([{ mic: true }]);
    expect(mic.thresholds).toEqual([undefined]);
    expect(mic.onGatedChunk).toBeNull();
  });

  it('when off, changes nothing: no gate, and the Start panel names no threshold', async () => {
    const bridge = withSpeechKey();
    const { mic, note } = await start(bridge, { transcribe: true });

    expect(note).not.toMatch(/threshold/);
    expect(note).toMatch(/From the default microphone\./);
    expect(bridge.startOptions).toEqual([{ mic: true, transcribeMic: true }]);
    expect(mic.thresholds).toEqual([undefined]);
    expect(mic.onGatedChunk).toBeNull();
  });
});
