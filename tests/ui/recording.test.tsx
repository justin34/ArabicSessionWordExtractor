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
  it('opens a panel with a disabled microphone option, and cancelling records nothing', async () => {
    const user = userEvent.setup();
    const { bridge, capture } = renderApp();

    const dialog = await openStartPanel(user);
    const mic = screen.getByRole('checkbox', { name: 'Also record my microphone' }) as HTMLInputElement;
    expect(mic.disabled).toBe(true);
    expect(dialog.textContent).toMatch(/coming soon/i);

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
