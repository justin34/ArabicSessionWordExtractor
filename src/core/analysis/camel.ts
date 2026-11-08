import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { ArabicAnalyzer, TokenAnalysis } from '../providers';

/** How to start the helper process. */
export interface HelperCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * The helper bundle built by `scripts/build-camel-helper.mjs`: embeddable Python, its
 * site-packages and the MSA data in `bundleDir`, running `script` (helper/camel/analyze.py).
 */
export function camelHelperCommand(bundleDir: string, script: string): HelperCommand {
  return {
    command: join(bundleDir, 'python', 'python.exe'),
    // UTF-8 everywhere; docopt's SyntaxWarnings on 3.13 are noise (spike #2).
    args: ['-X', 'utf8', '-W', 'ignore::SyntaxWarning', script],
    env: { CAMELTOOLS_DATA: join(bundleDir, 'data'), PYTHONIOENCODING: 'utf-8' },
  };
}

export interface CamelArabicAnalyzerOptions {
  helper: HelperCommand;
  /** First wait before restarting a helper that died; doubles per crash, up to 30 s. */
  restartDelayMs?: number;
  /** A sentence not answered in time fails, and the helper is presumed hung and restarted. */
  requestTimeoutMs?: number;
  log?: (message: string) => void;
}

const MAX_RESTART_DELAY_MS = 30_000;

interface Request {
  sentence: string;
  translation?: string;
  resolve(tokens: TokenAnalysis[]): void;
  reject(err: Error): void;
  timer: NodeJS.Timeout;
}

interface HelperReply {
  type?: string;
  id?: number | null;
  tokens?: TokenAnalysis[];
  error?: string;
}

/**
 * Arabic analysis by the CAMeL Tools helper (helper/camel/analyze.py), a long-lived Python
 * process: loading its model takes seconds, analyzing a sentence milliseconds.
 *
 * The analyzer supervises it. `start()` launches it; if it dies it is restarted after a
 * growing delay, and `close()` shuts it down for good. Sentences sent while it is starting
 * or restarting wait for it to be ready. A sentence in flight when it dies fails rather
 * than being retried, since it may be what killed the helper.
 */
export class CamelArabicAnalyzer implements ArabicAnalyzer {
  private readonly helper: HelperCommand;
  private readonly baseRestartDelayMs: number;
  private readonly requestTimeoutMs: number;
  private readonly log: (message: string) => void;

  private child: ChildProcess | undefined;
  private ready = false;
  private closed = false;
  private restartDelayMs: number;
  private restartTimer: NodeJS.Timeout | undefined;
  private nextId = 1;
  /** Waiting for the helper to be ready. */
  private readonly queued = new Map<number, Request>();
  /** Sent to the running helper, awaiting its reply. */
  private readonly inFlight = new Map<number, Request>();

  constructor({ helper, restartDelayMs = 1000, requestTimeoutMs = 15_000, log }: CamelArabicAnalyzerOptions) {
    this.helper = helper;
    this.baseRestartDelayMs = restartDelayMs;
    this.restartDelayMs = restartDelayMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.log = log ?? ((message) => console.log(`[arabic-analysis] ${message}`));
  }

  /** Launches the helper now, so its model is loaded before the first sentence arrives. */
  start(): void {
    if (this.closed || this.child || this.restartTimer) return;
    this.spawnHelper();
  }

  /** The process id of the running helper, if any. */
  get pid(): number | undefined {
    return this.child?.pid;
  }

  analyze(sentence: string, translation?: string): Promise<TokenAnalysis[]> {
    if (this.closed) return Promise.reject(new Error('Arabic analysis helper is shut down'));
    this.start();
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => this.timedOut(id), this.requestTimeoutMs);
      this.queued.set(id, { sentence, translation: translation || undefined, resolve, reject, timer });
      if (this.ready) this.sendQueued();
    });
  }

  /** Shuts the helper down and stops supervising it. Pending sentences fail. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    this.failAll(new Error('Arabic analysis helper is shut down'));
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    // Closing stdin asks it to exit; kill it if it does not.
    child.stdin?.end();
    const killTimer = setTimeout(() => child.kill(), 2000);
    await exited;
    clearTimeout(killTimer);
  }

  private spawnHelper(): void {
    this.ready = false;
    this.log('starting helper');
    const child = spawn(this.helper.command, this.helper.args, {
      env: { ...process.env, ...this.helper.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;

    createInterface({ input: child.stdout! }).on('line', (line) => this.received(child, line));
    createInterface({ input: child.stderr! }).on('line', (line) => this.log(`helper: ${line}`));
    // Writing to a helper that just died raises EPIPE here; the exit handler deals with it.
    child.stdin!.on('error', () => {});

    let gone = false;
    const onGone = (reason: string) => {
      if (gone) return;
      gone = true;
      this.exited(child, reason);
    };
    child.on('error', (err) => onGone(err.message));
    child.on('exit', (code, signal) => onGone(signal ? `signal ${signal}` : `code ${code}`));
  }

  private received(child: ChildProcess, line: string): void {
    if (child !== this.child) return;
    let reply: HelperReply;
    try {
      reply = JSON.parse(line) as HelperReply;
    } catch {
      this.log(`ignoring helper output: ${line}`);
      return;
    }
    if (reply.type === 'ready') {
      this.ready = true;
      // A helper that loaded its model is healthy again; the next crash starts the backoff afresh.
      this.restartDelayMs = this.baseRestartDelayMs;
      this.log('helper ready');
      this.sendQueued();
      return;
    }
    const request = typeof reply.id === 'number' ? this.inFlight.get(reply.id) : undefined;
    if (!request) return;
    this.inFlight.delete(reply.id as number);
    clearTimeout(request.timer);
    if (reply.error !== undefined) request.reject(new Error(`Arabic analysis failed: ${reply.error}`));
    else request.resolve(reply.tokens ?? []);
  }

  private sendQueued(): void {
    const stdin = this.child?.stdin;
    if (!stdin) return;
    for (const [id, request] of this.queued) {
      this.queued.delete(id);
      this.inFlight.set(id, request);
      stdin.write(`${JSON.stringify({ id, sentence: request.sentence, translation: request.translation })}\n`);
    }
  }

  private exited(child: ChildProcess, reason: string): void {
    if (child !== this.child) return;
    this.child = undefined;
    this.ready = false;
    for (const [id, request] of this.inFlight) {
      this.inFlight.delete(id);
      clearTimeout(request.timer);
      request.reject(new Error(`Arabic analysis helper stopped (${reason})`));
    }
    if (this.closed) return;
    this.log(`helper stopped (${reason}); restarting in ${this.restartDelayMs} ms`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (!this.closed) this.spawnHelper();
    }, this.restartDelayMs);
    this.restartDelayMs = Math.min(this.restartDelayMs * 2, MAX_RESTART_DELAY_MS);
  }

  private timedOut(id: number): void {
    const wasInFlight = this.inFlight.get(id);
    const request = wasInFlight ?? this.queued.get(id);
    if (!request) return;
    this.inFlight.delete(id);
    this.queued.delete(id);
    request.reject(new Error(`Arabic analysis timed out after ${this.requestTimeoutMs} ms`));
    // A ready helper takes milliseconds per sentence; one that does not answer is stuck.
    const child = this.child;
    if (wasInFlight && child) {
      this.log('helper did not answer; killing it');
      // Retire it now, so no further sentence is sent to it while it dies.
      this.exited(child, 'did not answer');
      child.kill();
    }
  }

  private failAll(err: Error): void {
    for (const pending of [this.queued, this.inFlight]) {
      for (const [id, request] of pending) {
        pending.delete(id);
        clearTimeout(request.timer);
        request.reject(err);
      }
    }
  }
}
