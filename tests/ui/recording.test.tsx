// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FakeBridge, FakeCapture, renderApp, session } from './harness';

afterEach(cleanup);

async function openStartPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Start Session' }));
  return screen.getByRole('dialog');
}

describe('Start flow', () => {
  it('opens a panel with an unticked microphone option, and cancelling records nothing', async () => {
    const user = userEvent.setup();
    const { bridge, capture } = renderApp();

    const dialog = await openStartPanel(user);
    const mic = screen.getByRole('checkbox', { name: 'Also record my microphone' }) as HTMLInputElement;
    expect(mic.disabled).toBe(false);
    expect(mic.checked).toBe(false);
    expect(dialog.textContent).toMatch(/separate track/i);
    // Transcribing the mic is unticked, and off until the mic itself is ticked.
    const transcribe = screen.getByRole('checkbox', { name: 'Also transcribe my speech' }) as HTMLInputElement;
    expect(transcribe.checked).toBe(false);
    expect(transcribe.disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(bridge.calls).toEqual([]);
    expect(capture.opened).toBe(0);
  });

  it('confirming starts the Session and lands in its Live View', async () => {
    const user = userEvent.setup();
    const { bridge, capture } = renderApp();

    await openStartPanel(user);
    await user.click(screen.getByRole('button', { name: 'Start' }));

    expect(await screen.findByRole('button', { name: 'Stop' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /live/i })).toBeTruthy();
    expect(screen.getByRole('meter', { name: 'Audio level' })).toBeTruthy();
    expect(screen.getByText('Listening…')).toBeTruthy();
    expect(screen.getByText(/speech-to-text/i)).toBeTruthy();
    expect(bridge.calls).toEqual(['start:1']);
    expect(capture.opened).toBe(1);
  });

  it('writes audio chunks to the Session in order', async () => {
    const user = userEvent.setup();
    const { bridge, capture } = renderApp();
    await openStartPanel(user);
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByRole('button', { name: 'Stop' });

    act(() => {
      capture.onChunk!(new Uint8Array([1]));
      capture.onChunk!(new Uint8Array([2]));
      capture.onChunk!(new Uint8Array([3]));
    });
    await waitFor(() => expect(bridge.chunks).toHaveLength(3));
    expect(bridge.chunks.map((c) => [c.sessionId, ...c.chunk])).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
    ]);
  });

  it('says so when no desktop audio is available, and records nothing', async () => {
    const user = userEvent.setup();
    const capture = new FakeCapture();
    capture.noAudio = true;
    const { bridge } = renderApp({ capture });

    await openStartPanel(user);
    await user.click(screen.getByRole('button', { name: 'Start' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/no desktop audio/i);
    expect(screen.getByRole('heading', { name: 'Sessions' })).toBeTruthy();
    expect(bridge.calls).toEqual([]);
  });

  it('closes the Session it created if recording fails to begin', async () => {
    const user = userEvent.setup();
    const capture = new FakeCapture();
    capture.beginError = new Error('recorder broke');
    const { bridge } = renderApp({ capture });

    await openStartPanel(user);
    await user.click(screen.getByRole('button', { name: 'Start' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/recorder broke/);
    expect(bridge.calls).toEqual(['start:1', 'stop:1']);
    expect(capture.stopped).toBe(1);
  });
});

describe('Stopping', () => {
  it('Stop returns to the Session List with the Session Completed', async () => {
    const user = userEvent.setup();
    const { bridge, capture } = renderApp();
    await openStartPanel(user);
    await user.click(screen.getByRole('button', { name: 'Start' }));

    await user.click(await screen.findByRole('button', { name: 'Stop' }));

    expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeTruthy();
    expect(await screen.findByText('Completed')).toBeTruthy();
    expect(bridge.calls).toEqual(['start:1', 'stop:1']);
    expect(capture.stopped).toBe(1);
  });

  it('warns that the recording may be incomplete when some audio could not be written', async () => {
    const user = userEvent.setup();
    const { bridge, capture } = renderApp();
    await openStartPanel(user);
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByRole('button', { name: 'Stop' });

    bridge.appendError = new Error('disk full');
    act(() => capture.onChunk!(new Uint8Array([1])));
    await user.click(screen.getByRole('button', { name: 'Stop' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/some audio could not be written/i);
    expect(alert.textContent).toMatch(/disk full/);
  });

  it('cannot start a second Session while one is recording', async () => {
    const user = userEvent.setup();
    renderApp();
    await openStartPanel(user);
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByRole('button', { name: 'Stop' });

    await user.click(screen.getByRole('button', { name: 'Sessions' }));
    const start = (await screen.findByRole('button', { name: 'Start Session' })) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
  });

  it('reopening a recording Session lands in its Live View', async () => {
    const user = userEvent.setup();
    const bridge = new FakeBridge([
      session({ id: 7, status: 'recording', endedAt: null, startedAt: new Date().toISOString() }),
    ]);
    renderApp({ bridge });

    await user.click(await screen.findByRole('button', { name: /open session/i }));
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByRole('heading', { name: 'Sessions' })).toBeTruthy();
  });
});

describe('Mic Track', () => {
  async function startWithMic(user: ReturnType<typeof userEvent.setup>) {
    await openStartPanel(user);
    await user.click(screen.getByRole('checkbox', { name: 'Also record my microphone' }));
    await user.click(screen.getByRole('button', { name: 'Start' }));
  }

  it('records no microphone unless the learner ticks the option', async () => {
    const user = userEvent.setup();
    const { bridge, mic } = renderApp();
    await openStartPanel(user);
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByRole('button', { name: 'Stop' });

    expect(bridge.startOptions).toEqual([{ mic: false }]);
    expect(mic.opened).toBe(0);
  });

  it('records the microphone to its own track, separate from the desktop audio', async () => {
    const user = userEvent.setup();
    const { bridge, capture, mic } = renderApp();
    await startWithMic(user);
    await screen.findByRole('button', { name: 'Stop' });

    expect(bridge.startOptions).toEqual([{ mic: true }]);
    expect(mic.opened).toBe(1);
    act(() => {
      capture.onChunk!(new Uint8Array([1]));
      mic.onChunk!(new Uint8Array([9]));
      mic.onChunk!(new Uint8Array([8]));
      capture.onChunk!(new Uint8Array([2]));
    });
    await waitFor(() => expect(bridge.micChunks).toHaveLength(2));
    await waitFor(() => expect(bridge.chunks).toHaveLength(2));
    expect(bridge.chunks.map((c) => [c.sessionId, ...c.chunk])).toEqual([[1, 1], [1, 2]]);
    expect(bridge.micChunks.map((c) => [c.sessionId, ...c.chunk])).toEqual([[1, 9], [1, 8]]);

    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await screen.findByRole('heading', { name: 'Sessions' });
    expect(capture.stopped).toBe(1);
    expect(mic.stopped).toBe(1);
    expect(bridge.calls).toEqual(['start:1', 'stop:1']);
  });

  it('starts nothing and says so when the microphone cannot be opened', async () => {
    const user = userEvent.setup();
    const mic = new FakeCapture();
    mic.openError = new Error('Permission denied');
    const { bridge, capture } = renderApp({ mic });
    await startWithMic(user);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not open the microphone/i);
    expect(alert.textContent).toMatch(/Permission denied/);
    expect(bridge.calls).toEqual([]);
    expect(capture.opened).toBe(1);
    expect(capture.stopped).toBe(1);
  });

  it('releases the microphone too if recording fails to begin', async () => {
    const user = userEvent.setup();
    const capture = new FakeCapture();
    capture.beginError = new Error('recorder broke');
    const { bridge, mic } = renderApp({ capture });
    await startWithMic(user);

    expect((await screen.findByRole('alert')).textContent).toMatch(/recorder broke/);
    expect(bridge.calls).toEqual(['start:1', 'stop:1']);
    expect(mic.stopped).toBe(1);
  });
});
