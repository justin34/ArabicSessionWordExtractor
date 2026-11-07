import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CamelArabicAnalyzer, type CamelArabicAnalyzerOptions } from '../../src/core/analysis/camel';

const fakeHelper = join(__dirname, 'fakeHelper.mjs');

let dir: string;
let analyzer: CamelArabicAnalyzer | undefined;

function supervise(env: Record<string, string> = {}, options: Partial<CamelArabicAnalyzerOptions> = {}) {
  analyzer = new CamelArabicAnalyzer({
    helper: { command: process.execPath, args: [fakeHelper], env },
    restartDelayMs: 20,
    log: () => {},
    ...options,
  });
  return analyzer;
}

async function helperPid(a: CamelArabicAnalyzer): Promise<number> {
  const [token] = await a.analyze('pid');
  return Number(token!.lemma);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ill-helper-'));
});

afterEach(async () => {
  await analyzer?.close();
  analyzer = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe('Arabic analysis helper supervision', () => {
  it('starts the helper before the first sentence, and answers sentences', async () => {
    const a = supervise();
    a.start();
    expect(a.pid).toBeTypeOf('number');

    expect(await a.analyze('كتب الطالب')).toEqual([
      { surface: 'كتب', lemma: 'كتب' },
      { surface: 'الطالب', lemma: 'الطالب' },
    ]);
  });

  it('answers sentences sent at once, each with its own reply', async () => {
    const a = supervise();

    const replies = await Promise.all(['أ ب', 'ج', 'د ه و'].map((s) => a.analyze(s)));

    expect(replies.map((tokens) => tokens.length)).toEqual([2, 1, 3]);
  });

  it('restarts the helper after it crashes; the sentence in flight fails, the next succeeds', async () => {
    const a = supervise();
    const first = await helperPid(a);

    await expect(a.analyze('crash')).rejects.toThrow(/helper stopped/);
    await until(() => !isRunning(first));

    const second = await helperPid(a);
    expect(second).not.toBe(first);
    expect(await a.analyze('مرحبا')).toEqual([{ surface: 'مرحبا', lemma: 'مرحبا' }]);
  });

  it('keeps restarting a helper that dies on startup until it comes up', async () => {
    const starts = join(dir, 'starts');
    const a = supervise({ FAKE_HELPER_STARTS: starts, FAKE_HELPER_FAIL_STARTS: '2' });

    expect(await a.analyze('مرحبا')).toHaveLength(1);
    expect(readFileSync(starts, 'utf8')).toBe('3');
  });

  it('fails one bad sentence without restarting the helper', async () => {
    const a = supervise();
    const pid = await helperPid(a);

    await expect(a.analyze('fail')).rejects.toThrow(/ValueError: bad sentence/);
    expect(await helperPid(a)).toBe(pid);
  });

  it('times out a sentence the helper never answers, and replaces the stuck helper', async () => {
    const a = supervise({}, { requestTimeoutMs: 300 });
    const stuck = await helperPid(a);

    await expect(a.analyze('hang')).rejects.toThrow(/timed out/);
    await until(() => !isRunning(stuck));
    expect(await helperPid(a)).not.toBe(stuck);
  });

  it('shuts the helper down on close and does not restart it', async () => {
    const a = supervise();
    const pid = await helperPid(a);
    const pending = expect(a.analyze('hang')).rejects.toThrow(/shut down/);

    await a.close();

    await pending;
    expect(isRunning(pid)).toBe(false);
    await new Promise((r) => setTimeout(r, 100));
    expect(a.pid).toBeUndefined();
    await expect(a.analyze('مرحبا')).rejects.toThrow(/shut down/);
  });

  it('keeps trying when the helper cannot be launched at all', async () => {
    const logs: string[] = [];
    analyzer = new CamelArabicAnalyzer({
      helper: { command: join(dir, 'missing.exe'), args: [] },
      restartDelayMs: 20,
      requestTimeoutMs: 300,
      log: (m) => logs.push(m),
    });

    await expect(analyzer.analyze('مرحبا')).rejects.toThrow(/timed out/);
    expect(logs.filter((m) => m.startsWith('helper stopped')).length).toBeGreaterThan(1);
  });
});
