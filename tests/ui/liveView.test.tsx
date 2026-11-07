// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LiveUtterance } from '../../src/renderer/bridge';
import { FakeBridge, ManualDemoFeed, renderApp, session } from './harness';

afterEach(cleanup);

const tok = (surface: string, gloss: string, i: number) => ({
  surface,
  gloss,
  startMs: i * 400,
  endMs: i * 400 + 350,
  lemmaId: null,
});

const interim = (id: string, text: string): LiveUtterance => ({
  id,
  isFinal: false,
  text,
  translation: '',
  tokens: [],
});

const final = (id: string, words: Array<[string, string]>, translation: string): LiveUtterance => ({
  id,
  isFinal: true,
  text: words.map(([w]) => w).join(' '),
  translation,
  tokens: words.map(([w, g], i) => tok(w, g, i)),
});

async function enterDemoLiveView() {
  const user = userEvent.setup();
  const demo = new ManualDemoFeed();
  const view = renderApp({ demo });
  await user.click(await screen.findByRole('button', { name: 'Start Demo Session' }));
  return { user, demo, ...view };
}

describe('Live View transcript', () => {
  it('shows interim text muted and without glosses', async () => {
    const { demo } = await enterDemoLiveView();
    act(() => demo.emit(interim('u1', 'مرحبا')));

    const utterance = screen.getByText('مرحبا').closest('article')!;
    expect(utterance.getAttribute('data-state')).toBe('interim');
    expect(within(utterance).queryByText('hello')).toBeNull();
    expect(screen.queryByText('Listening…')).toBeNull();
  });

  it('finalizing an Utterance fills in word columns with glosses and the sentence translation', async () => {
    const { demo } = await enterDemoLiveView();
    act(() => demo.emit(interim('u1', 'مرحبا بكم')));
    act(() =>
      demo.emit(final('u1', [['مرحبا', 'hello'], ['بكم', 'to you all']], 'Welcome, everyone.')),
    );

    const utterances = screen.getAllByRole('article');
    expect(utterances).toHaveLength(1);
    expect(utterances[0].getAttribute('data-state')).toBe('final');
    expect(within(utterances[0]).getByText('Welcome, everyone.')).toBeTruthy();

    const words = within(utterances[0]).getAllByRole('group');
    expect(words).toHaveLength(2);
    // Each word is a stacked column: Arabic first, its gloss under it.
    expect(words[0].children[0].textContent).toBe('مرحبا');
    expect(words[0].children[1].textContent).toBe('hello');
    expect(words[1].children[1].textContent).toBe('to you all');
  });

  it('lays Arabic out right to left while keeping English left to right', async () => {
    const { demo } = await enterDemoLiveView();
    act(() => demo.emit(final('u1', [['مرحبا', 'hello']], 'Hello.')));

    const word = screen.getByRole('group');
    expect(word.parentElement!.getAttribute('dir')).toBe('rtl');
    expect(word.children[0].getAttribute('lang')).toBe('ar');
    expect(screen.getByText('Hello.').getAttribute('dir')).toBe('ltr');
  });
});

describe('Live View translation warning', () => {
  const failed = (id: string, error: string): LiveUtterance => ({
    ...final(id, [['مرحبا', '']], ''),
    translationError: error,
  });

  it('warns, with the reason, when a sentence could not be translated, keeping its Arabic', async () => {
    const { demo } = await enterDemoLiveView();
    expect(screen.queryByRole('status')).toBeNull();

    act(() => demo.emit(final('u1', [['مرحبا', '']], '')));
    act(() => demo.emit(failed('u1', 'Google Translation error 403: blocked')));

    const warning = screen.getByRole('status');
    expect(warning.textContent).toMatch(/translation isn’t working/i);
    expect(warning.textContent).toContain('Google Translation error 403: blocked');
    expect(within(screen.getByRole('article')).getByText('مرحبا')).toBeTruthy();
  });

  it('clears the warning once a later sentence is translated', async () => {
    const { demo } = await enterDemoLiveView();
    act(() => demo.emit(failed('u1', 'timeout')));
    expect(screen.getByRole('status')).toBeTruthy();

    act(() => demo.emit(final('u2', [['شكرا', 'thanks']], 'Thank you.')));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('Thank you.')).toBeTruthy();
  });
});

describe('Live View auto-scroll', () => {
  // jsdom does no layout, so give scrollable elements a controllable one.
  beforeAll(() => {
    type Fake = HTMLElement & { _h?: number; _c?: number; _t?: number };
    Object.defineProperties(HTMLElement.prototype, {
      scrollHeight: { configurable: true, get: function (this: Fake) { return this._h ?? 0; } },
      clientHeight: { configurable: true, get: function (this: Fake) { return this._c ?? 0; } },
      scrollTop: {
        configurable: true,
        get: function (this: Fake) { return this._t ?? 0; },
        set: function (this: Fake, v: number) { this._t = v; },
      },
    });
  });

  type Fake = HTMLElement & { _h: number; _c: number; _t: number };
  const addUtterance = (demo: ManualDemoFeed, log: Fake, n: number) => {
    log._h += 100; // the new Utterance makes the content taller
    act(() => demo.emit(final(`u${n}`, [['كلمة', 'word']], `Sentence ${n}`)));
  };

  async function setup() {
    const ctx = await enterDemoLiveView();
    const log = screen.getByRole('log') as Fake;
    log._h = 100;
    log._c = 400;
    log._t = 0;
    return { ...ctx, log };
  }

  it('follows new Utterances to the bottom', async () => {
    const { demo, log } = await setup();
    addUtterance(demo, log, 1);
    addUtterance(demo, log, 2);
    expect(log.scrollTop).toBe(log.scrollHeight);
  });

  it('pauses when the learner scrolls up, and offers a jump back to the latest', async () => {
    const { demo, log, user } = await setup();
    addUtterance(demo, log, 1);
    log._h = 1000;
    log._t = 200; // scrolled well above the bottom (600)
    fireEvent.scroll(log);

    addUtterance(demo, log, 2);
    expect(log.scrollTop).toBe(200);

    await user.click(screen.getByRole('button', { name: /latest/i }));
    expect(log.scrollTop).toBe(log.scrollHeight);
    expect(screen.queryByRole('button', { name: /latest/i })).toBeNull();
  });

  it('resumes when the learner scrolls back to the bottom', async () => {
    const { demo, log } = await setup();
    log._h = 1000;
    log._t = 200;
    fireEvent.scroll(log);
    expect(screen.getByRole('button', { name: /latest/i })).toBeTruthy();

    log._t = 600; // bottom
    fireEvent.scroll(log);
    expect(screen.queryByRole('button', { name: /latest/i })).toBeNull();

    addUtterance(demo, log, 3);
    expect(log.scrollTop).toBe(log.scrollHeight);
  });
});

describe('Demo Session', () => {
  it('is not offered when the app has no demo feed (packaged build)', async () => {
    renderApp();
    await screen.findByRole('button', { name: 'Start Session' });
    expect(screen.queryByRole('button', { name: /demo/i })).toBeNull();
  });

  it('shares Live View with real Sessions, is badged, and never touches the store', async () => {
    const { demo, bridge } = await enterDemoLiveView();
    expect(demo.started).toBe(1);
    expect(screen.getByRole('heading', { name: 'Live View' })).toBeTruthy();
    expect(screen.getByText('Demo')).toBeTruthy();
    expect(bridge.calls).toEqual([]);
    expect(await bridge.listSessions()).toEqual([]);
  });

  it('stopping ends the feed and leaves a Completed Demo Session in the list', async () => {
    const { demo, user } = await enterDemoLiveView();
    await user.click(screen.getByRole('button', { name: 'Stop' }));

    expect(demo.cancelled).toBe(1);
    const list = await screen.findByRole('list', { name: 'Session list' });
    const row = within(list).getByRole('listitem');
    expect(within(row).getByText('Demo')).toBeTruthy();
    expect(within(row).getByText('Completed')).toBeTruthy();
  });
});

describe('Live View for a real Session', () => {
  it('shows the Listening empty state, then renders transcript updates from the bridge', async () => {
    const user = userEvent.setup();
    const bridge = new FakeBridge([
      session({ id: 7, status: 'recording', endedAt: null, startedAt: new Date().toISOString() }),
    ]);
    renderApp({ bridge });
    await user.click(await screen.findByRole('button', { name: /open session/i }));

    expect(screen.getByText('Listening…')).toBeTruthy();
    expect(screen.getByText(/as it is spoken/i)).toBeTruthy();

    act(() => bridge.emit(7, final('a', [['سلام', 'peace']], 'Peace.')));
    expect(screen.getByText('Peace.')).toBeTruthy();
    expect(screen.queryByText('Listening…')).toBeNull();
  });

  it("keeps the recording Session's transcript while the learner is on the Session List", async () => {
    const user = userEvent.setup();
    const { bridge } = renderApp();
    await user.click(await screen.findByRole('button', { name: 'Start Session' }));
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await user.click(await screen.findByRole('button', { name: /back to sessions/i }));

    act(() => bridge.emit(1, interim('a', 'مرحبا')));
    act(() => bridge.emit(1, final('a', [['مرحبا', 'hello']], 'Hello.')));
    await user.click(screen.getByRole('button', { name: /open session/i }));

    expect(screen.getByText('Hello.')).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it('shows a final Utterance whose words have no glosses yet as plain right-to-left Arabic', async () => {
    const { demo } = await enterDemoLiveView();
    act(() => demo.emit(final('u1', [['مرحبا', ''], ['بكم', '']], '')));

    const utterance = screen.getByRole('article');
    expect(utterance.getAttribute('data-state')).toBe('final');
    expect(within(utterance).queryAllByRole('group')).toHaveLength(0);
    const text = within(utterance).getByText('مرحبا بكم');
    expect(text.getAttribute('dir')).toBe('rtl');
    expect(text.getAttribute('lang')).toBe('ar');
  });
});

