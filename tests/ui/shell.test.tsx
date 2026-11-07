// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness';

afterEach(cleanup);

describe('App shell', () => {
  it('opens on Sessions with the sidebar showing it as active', async () => {
    renderApp();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Sessions');
    expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeTruthy();
  });

  it('shows clear empty states for Vocabulary and Settings and tracks the active destination', async () => {
    const user = userEvent.setup();
    renderApp();
    const nav = screen.getByRole('navigation', { name: 'Main' });

    await user.click(screen.getByRole('button', { name: 'Vocabulary' }));
    expect(screen.getByRole('heading', { name: 'Vocabulary' })).toBeTruthy();
    expect(screen.getByText(/coming soon/i)).toBeTruthy();
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Vocabulary');

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByText(/coming soon/i)).toBeTruthy();
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Settings');
  });
});
