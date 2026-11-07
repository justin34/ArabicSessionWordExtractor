// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FakeBridge, renderApp, session } from './harness';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const started = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

describe('Session List', () => {
  it('prompts for a first Session when there are none', async () => {
    renderApp();
    expect(await screen.findByText(/no sessions yet/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start Session' })).toBeTruthy();
  });

  it('lists Sessions newest first with start time, duration and status', async () => {
    const bridge = new FakeBridge([
      session({ id: 1, startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-01T10:12:34.000Z' }),
      session({ id: 2, startedAt: '2026-01-02T09:00:00.000Z', endedAt: '2026-01-02T10:01:05.000Z' }),
    ]);
    renderApp({ bridge });

    const rows = within(await screen.findByRole('list', { name: 'Session list' })).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText(started('2026-01-02T09:00:00.000Z'))).toBeTruthy();
    expect(within(rows[0]).getByText('1:01:05')).toBeTruthy();
    expect(within(rows[0]).getByText('Completed')).toBeTruthy();
    expect(within(rows[1]).getByText(started('2026-01-01T10:00:00.000Z'))).toBeTruthy();
    expect(within(rows[1]).getByText('12:34')).toBeTruthy();
  });

  it('shows a live elapsed counter and a Recording badge for an in-progress Session', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-01-01T10:00:05.000Z'));
    const bridge = new FakeBridge([
      session({ id: 1, status: 'recording', endedAt: null, startedAt: '2026-01-01T10:00:00.000Z' }),
    ]);
    renderApp({ bridge });

    const row = within(await screen.findByRole('list', { name: 'Session list' })).getByRole('listitem');
    expect(within(row).getByText('Recording')).toBeTruthy();
    expect(within(row).getByText('0:05')).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(within(row).getByText('0:08')).toBeTruthy();
  });

  it('opens a completed Session on its Session Guide, noting Replay is to come, with a way back', async () => {
    const user = userEvent.setup();
    renderApp({ bridge: new FakeBridge([session({ id: 1 })]) });

    await user.click(await screen.findByRole('button', { name: /open session/i }));
    expect(screen.getByText(/replay coming soon/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByRole('heading', { name: 'Sessions' })).toBeTruthy();
  });
});
