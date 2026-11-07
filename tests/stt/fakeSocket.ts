import { AudioChannel } from '../../src/core/audioChannel';
import type { SttEvent } from '../../src/core/providers';
import type { Connect, SocketLike } from '../../src/core/stt/socket';

type Listener = (event: { data?: unknown; code?: number; reason?: string }) => void;

/** Stands in for a speech-to-text service's WebSocket; the test plays the server. */
export class FakeSocket implements SocketLike {
  binaryType = 'blob';
  /** Frames the adapter sent, in order. */
  sent: Array<string | Uint8Array> = [];
  closed = false;
  private listeners = new Map<string, Listener[]>();

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {}

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.fire('close', { code: 1000, reason: '' });
  }

  // Server side.
  open(): void {
    this.fire('open', {});
  }
  receive(message: unknown): void {
    this.fire('message', { data: JSON.stringify(message) });
  }
  drop(code: number, reason = ''): void {
    this.closed = true;
    this.fire('close', { code, reason });
  }

  private fire(type: string, event: Parameters<Listener>[0]): void {
    for (const l of this.listeners.get(type) ?? []) l(event);
  }
}

/** Flushes pending promise callbacks so the adapter can react. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Starts an adapter on a fresh audio channel and a fake socket, and collects its events.
 * `socket` exists once the adapter has connected.
 */
export async function startStreaming(
  transcribe: (connect: Connect) => (audio: AsyncIterable<Uint8Array>) => AsyncIterable<SttEvent>,
) {
  const audio = new AudioChannel();
  let socket: FakeSocket | undefined;
  const connect: Connect = (url, protocols) => (socket = new FakeSocket(url, protocols));
  const events: SttEvent[] = [];
  const done = (async () => {
    for await (const e of transcribe(connect)(audio)) events.push(e);
  })();
  done.catch(() => undefined);
  await settle();
  if (!socket) throw new Error('adapter did not connect');
  return { audio, socket, events, done };
}
