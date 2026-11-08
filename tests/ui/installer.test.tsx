// @vitest-environment jsdom
// GLOSSARY: Installer. What a packaged build tells the learner: a missing bundled part, and
// a downloaded update, which never interrupts a recording.
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BUNDLE_PROBLEMS } from '../../src/core/bundle';
import { FakeBridge, renderApp, session } from './harness';

afterEach(cleanup);

const restartButton = () => screen.queryByRole('button', { name: 'Restart to update' });

describe('A packaged build missing its helper or dictionary', () => {
  it('says what is unavailable and to reinstall, on every screen', async () => {
    const user = userEvent.setup();
    const bridge = new FakeBridge();
    bridge.problems = [BUNDLE_PROBLEMS.analysis, BUNDLE_PROBLEMS.dictionary];
    renderApp({ bridge });

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.map((a) => a.textContent)).toEqual([
      expect.stringMatching(/^Word analysis is unavailable.*Reinstall Arabic Session Word Extractor/),
      expect.stringMatching(/^The dictionary is unavailable.*Reinstall Arabic Session Word Extractor/),
    ]);
    await user.click(screen.getByRole('button', { name: 'Vocabulary' }));
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });

  it('says nothing when everything is bundled', async () => {
    renderApp();
    await screen.findByRole('heading', { name: 'Sessions' });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Restart to update', () => {
  it('offers the update once it has downloaded, and restarts into it', async () => {
    const user = userEvent.setup();
    const { bridge } = renderApp();
    await screen.findByRole('heading', { name: 'Sessions' });
    expect(restartButton()).toBeNull();

    act(() => bridge.downloadUpdate('0.1.1'));
    expect(screen.getByRole('status').textContent).toMatch(/Version 0\.1\.1 is ready/);
    await user.click(restartButton()!);
    expect(bridge.restarts).toBe(1);
  });

  it('offers an update that downloaded before the window opened', async () => {
    const bridge = new FakeBridge();
    bridge.update = { version: '0.1.1' };
    renderApp({ bridge });
    expect(await screen.findByRole('button', { name: 'Restart to update' })).toBeTruthy();
  });

  it('is never shown while this window records a Session, and appears once it stops', async () => {
    const user = userEvent.setup();
    const { bridge } = renderApp();
    await user.click(await screen.findByRole('button', { name: 'Start Session' }));
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByRole('button', { name: 'Stop' });

    act(() => bridge.downloadUpdate('0.1.1'));
    expect(restartButton()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Sessions' }));
    expect(restartButton()).toBeNull();

    await user.click(screen.getByRole('button', { name: /^Open session from/ }));
    await user.click(await screen.findByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(restartButton()).toBeTruthy());
  });

  it('is never shown while another window records a Session', async () => {
    const bridge = new FakeBridge([session({ id: 1, status: 'recording', endedAt: null })]);
    bridge.update = { version: '0.1.1' };
    renderApp({ bridge });
    await screen.findByRole('heading', { name: 'Sessions' });
    await act(async () => {});
    expect(restartButton()).toBeNull();
  });

  it('says why when the restart is refused', async () => {
    const user = userEvent.setup();
    const bridge = new FakeBridge();
    bridge.update = { version: '0.1.1' };
    bridge.restartError = new Error('Stop the Session that is recording first.');
    renderApp({ bridge });
    await user.click(await screen.findByRole('button', { name: 'Restart to update' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not restart to update: Stop the Session/);
  });
});
