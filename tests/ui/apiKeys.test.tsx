// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FakeBridge, renderApp } from './harness';

afterEach(cleanup);

async function openKeys(bridge = new FakeBridge()) {
  const user = userEvent.setup();
  const view = renderApp({ bridge });
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  await screen.findByLabelText('Soniox API key');
  return { user, ...view };
}

const field = (label: string) => screen.getByLabelText(label).closest('form') as HTMLElement;

describe('API keys in Settings', () => {
  it('lists the Soniox, Deepgram and Google keys, and warns when there is no speech-to-text key', async () => {
    await openKeys();

    for (const label of ['Soniox API key', 'Deepgram API key', 'Google Cloud Translation API key']) {
      expect((screen.getByLabelText(label) as HTMLInputElement).type).toBe('password');
      expect(within(field(label)).getByText(/Not set\./)).toBeTruthy();
    }
    expect(screen.getByText(/Without a Soniox or Deepgram key, Sessions record audio but no Transcript/)).toBeTruthy();
  });

  it('saves a key as entered, then checks it with its service and says it works', async () => {
    const { user, bridge } = await openKeys();

    await user.type(screen.getByLabelText('Soniox API key'), '  sk-test-1234 ');
    await user.click(screen.getByRole('button', { name: 'Save Soniox key' }));

    expect(bridge.savedKeys).toEqual([{ name: 'soniox', key: '  sk-test-1234 ' }]);
    expect(await screen.findByText('The service accepted the key.')).toBeTruthy();
    expect(bridge.checkedKeys).toEqual(['soniox']);
    expect((screen.getByLabelText('Soniox API key') as HTMLInputElement).value).toBe('');
    expect(within(field('Soniox API key')).getByText(/Saved, ending …1234\./)).toBeTruthy();
    expect(screen.queryByText(/Without a Soniox or Deepgram key/)).toBeNull();
  });

  it('explains how to fix a key its service refuses', async () => {
    const bridge = new FakeBridge();
    bridge.keyChecks.set('googleTranslate', {
      ok: false,
      problem: 'invalid',
      message: 'Google accepted the key but will not translate with it. Enable the Cloud Translation API.',
    });
    const { user } = await openKeys(bridge);

    await user.type(screen.getByLabelText('Google Cloud Translation API key'), 'AIza-bad');
    await user.click(screen.getByRole('button', { name: 'Save Google Cloud Translation key' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Enable the Cloud Translation API/);
  });

  it('checks a saved key again on request, and removes it', async () => {
    const bridge = new FakeBridge();
    bridge.keys.set('deepgram', 'dg-5678');
    bridge.keyChecks.set('deepgram', { ok: false, problem: 'unreachable', message: 'Could not reach Deepgram (offline).' });
    const { user } = await openKeys(bridge);

    await user.click(screen.getByRole('button', { name: 'Check Deepgram key' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not reach Deepgram/);

    await user.click(screen.getByRole('button', { name: 'Remove Deepgram key' }));
    expect(await screen.findByText('Key removed.')).toBeTruthy();
    expect(bridge.keys.has('deepgram')).toBe(false);
    expect(within(field('Deepgram API key')).getByText(/Not set\./)).toBeTruthy();
  });

  it('shows a key set by the environment, which can be checked but not removed here', async () => {
    const bridge = new FakeBridge();
    bridge.envKeys.set('soniox', 'env-key-abcd');
    await openKeys(bridge);

    expect(within(field('Soniox API key')).getByText(/Set by SONIOX_API_KEY in the environment, ending …abcd/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check Soniox key' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove Soniox key' })).toBeNull();
  });

  it('says when a key could not be saved, and keeps what was typed', async () => {
    const bridge = new FakeBridge();
    bridge.saveKeyError = new Error('That does not look like an API key: paste it without spaces.');
    const { user } = await openKeys(bridge);

    await user.type(screen.getByLabelText('Soniox API key'), 'two words');
    await user.click(screen.getByRole('button', { name: 'Save Soniox key' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not save the key: .*without spaces/);
    expect((screen.getByLabelText('Soniox API key') as HTMLInputElement).value).toBe('two words');
    expect(bridge.checkedKeys).toEqual([]);
  });
});

describe('Missing keys at Session start', () => {
  it('warns that a Session without keys records no Transcript and no translations, and links to Settings', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('button', { name: 'Start Session' }));
    const dialog = screen.getByRole('dialog');

    expect(await within(dialog).findByText(/No speech-to-text key: the audio will be recorded, but without a Transcript/)).toBeTruthy();
    expect(within(dialog).getByText(/No translation key/)).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Add keys in Settings' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByRole('heading', { name: 'API keys' })).toBeTruthy();
  });

  it('warns about nothing when the keys are set, from Settings or the environment', async () => {
    const bridge = new FakeBridge();
    bridge.keys.set('deepgram', 'dg');
    bridge.envKeys.set('googleTranslate', 'AIza');
    const user = userEvent.setup();
    renderApp({ bridge });
    await user.click(await screen.findByRole('button', { name: 'Start Session' }));
    await screen.findByText(/Transcribing:/);
    await act(() => Promise.resolve());

    expect(screen.queryByText(/No speech-to-text key/)).toBeNull();
    expect(screen.queryByText(/No translation key/)).toBeNull();
  });
});

describe('Live View when transcription stops', () => {
  async function record(bridge = new FakeBridge()) {
    const user = userEvent.setup();
    const view = renderApp({ bridge });
    await user.click(await screen.findByRole('button', { name: 'Start Session' }));
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByRole('button', { name: 'Stop' });
    return { user, ...view };
  }

  it('says the audio is still recording, keeps writing it, and stops cleanly', async () => {
    const { user, bridge, capture } = await record();

    act(() => bridge.failTranscription(1, 'stt-rt.soniox.com closed the stream: 1006'));
    const warning = await screen.findByText(/Transcription has stopped; the audio is still recording/);
    expect(warning.parentElement!.textContent).toMatch(/1006/);

    act(() => capture.onChunk!(new Uint8Array([4])));
    await waitFor(() => expect(bridge.chunks.map((c) => [...c.chunk])).toEqual([[4]]));
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(bridge.calls).toEqual(['start:1', 'stop:1']);
  });

  it('shows a failure that came before Live View subscribed, e.g. no key', async () => {
    const bridge = new FakeBridge();
    bridge.failures.set(1, 'No speech-to-text key: audio is recorded without a Transcript.');
    await record(bridge);

    expect(await screen.findByText(/Transcription has stopped/)).toBeTruthy();
    expect(screen.getByText(/No speech-to-text key/)).toBeTruthy();
  });
});
