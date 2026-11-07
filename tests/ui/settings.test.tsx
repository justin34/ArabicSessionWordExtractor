// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FakeAudioInputs, FakeBridge, FakeCapture, renderApp } from './harness';

afterEach(cleanup);

const stereoMix = { deviceId: 'mix', label: 'Stereo Mix (Realtek)' };
const cable = { deviceId: 'cable', label: 'CABLE Output (VB-Audio)' };
const headset = { deviceId: 'headset', label: 'Headset Microphone' };

async function openSettings(opts: Parameters<typeof renderApp>[0] = {}) {
  const user = userEvent.setup();
  const inputs = opts.inputs ?? new FakeAudioInputs([stereoMix, cable, headset]);
  const view = renderApp({ ...opts, inputs });
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  const desktop = (await screen.findByRole('combobox', { name: 'Desktop audio (transcribed)' })) as HTMLSelectElement;
  const micSelect = screen.getByRole("combobox", { name: "Microphone (Mic Track)" }) as HTMLSelectElement;
  await waitFor(() => expect(desktop.options.length).toBeGreaterThan(1));
  return { ...view, user, desktop, mic: micSelect };
}

const labels = (select: HTMLSelectElement) => [...select.options].map((o) => o.textContent);

describe('Audio settings screen', () => {
  it('offers all system audio or any input to transcribe, and the default or any microphone', async () => {
    const { desktop, mic } = await openSettings();

    expect(labels(desktop)).toEqual(['All system audio', stereoMix.label, cable.label, headset.label]);
    expect(labels(mic)).toEqual(['System default', stereoMix.label, cable.label, headset.label]);
    expect(desktop.value).toBe('');
    expect(mic.value).toBe('');
  });

  it('saves each choice as it is made', async () => {
    const { user, desktop, mic, bridge } = await openSettings();

    await user.selectOptions(desktop, cable.label);
    await user.selectOptions(mic, headset.label);

    expect(bridge.savedAudio).toEqual([
      { desktopSource: cable, microphone: null },
      { desktopSource: cable, microphone: headset },
    ]);
    expect(await screen.findByText('Saved.')).toBeTruthy();

    await user.selectOptions(desktop, 'All system audio');
    expect(bridge.audio).toEqual({ desktopSource: null, microphone: headset });
  });

  it('shows a saved device that is unplugged, and lists devices again on refresh', async () => {
    const bridge = new FakeBridge();
    bridge.audio = { desktopSource: cable, microphone: null };
    const inputs = new FakeAudioInputs([headset]);
    const { user, desktop } = await openSettings({ bridge, inputs });

    expect(desktop.value).toBe('cable');
    expect(labels(desktop)).toContain('CABLE Output (VB-Audio) (not connected)');

    inputs.devices = [headset, cable];
    await user.click(screen.getByRole('button', { name: 'Refresh devices' }));
    await waitFor(() => expect(labels(desktop)).toEqual(['All system audio', headset.label, cable.label]));
  });

  it('says when a choice could not be saved', async () => {
    const bridge = new FakeBridge();
    bridge.saveAudioError = new Error('disk full');
    const { user, desktop } = await openSettings({ bridge });

    await user.selectOptions(desktop, stereoMix.label);
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not save: disk full/i);
  });
});

describe('Recording from the chosen devices', () => {
  async function start(bridge: FakeBridge, opts: { mic?: boolean; capture?: FakeCapture } = {}) {
    const user = userEvent.setup();
    const view = renderApp({ bridge, capture: opts.capture });
    await user.click(await screen.findByRole('button', { name: 'Start Session' }));
    const dialog = await screen.findByRole('dialog');
    await screen.findByText(/Transcribing:/);
    if (opts.mic) await user.click(screen.getByRole('checkbox', { name: 'Also record my microphone' }));
    await user.click(screen.getByRole('button', { name: 'Start' }));
    return { user, dialog, ...view };
  }

  it('records the system audio and default microphone when nothing is chosen', async () => {
    const { capture, mic } = await start(new FakeBridge(), { mic: true });
    await screen.findByRole('button', { name: 'Stop' });

    expect(capture.openedWith).toEqual([null]);
    expect(mic.openedWith).toEqual([null]);
  });

  it('names the chosen devices in the Start panel and records from them', async () => {
    const bridge = new FakeBridge();
    bridge.audio = { desktopSource: cable, microphone: headset };
    const user = userEvent.setup();
    const { capture, mic } = renderApp({ bridge });
    await user.click(await screen.findByRole('button', { name: 'Start Session' }));

    const dialog = await screen.findByRole('dialog');
    expect(await screen.findByText(cable.label)).toBeTruthy();
    expect(dialog.textContent).toMatch(/From Headset Microphone/);
    await user.click(screen.getByRole('checkbox', { name: 'Also record my microphone' }));
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByRole('button', { name: 'Stop' });

    expect(capture.openedWith).toEqual([cable]);
    expect(mic.openedWith).toEqual([headset]);
  });

  it('starts nothing and points to Settings when a chosen device is unplugged', async () => {
    const bridge = new FakeBridge();
    bridge.audio = { desktopSource: cable, microphone: null };
    const capture = new FakeCapture();
    capture.unplugged.add('cable');
    await start(bridge, { capture });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/CABLE Output \(VB-Audio\)” is not available/);
    expect(alert.textContent).toMatch(/Settings/);
    expect(bridge.calls).toEqual([]);
  });
});
