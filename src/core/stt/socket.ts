import type { SttEvent, SttWord } from '../providers';

interface SocketEvent {
  data?: unknown;
  code?: number;
  reason?: string;
}

/** The part of a WebSocket the speech-to-text adapters use. */
export interface SocketLike {
  binaryType: string;
  send(data: string | Uint8Array): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: SocketEvent) => void): void;
}

/** Opens a WebSocket; tests substitute a fake server. */
export type Connect = (url: string, protocols: string[]) => SocketLike;

export const connectWebSocket: Connect = (url, protocols) =>
  new WebSocket(url, protocols) as unknown as SocketLike;

/** An event for a whole Utterance made of these words; only final events carry the words. */
export function utteranceEvent(type: SttEvent['type'], words: SttWord[]): SttEvent {
  const event: SttEvent = {
    type,
    text: words.map((w) => w.text).join(' '),
    startMs: words[0]?.startMs ?? 0,
    endMs: words.at(-1)?.endMs ?? 0,
  };
  return type === 'final' ? { ...event, words } : event;
}

/** How one streaming service speaks over its socket. */
export interface SocketProtocol {
  url: string;
  /** WebSocket subprotocols; both services take the API key this way. */
  protocols: string[];
  /** Text frame sent once the socket opens, before any audio. */
  start?: string;
  /** Text frame that tells the service no more audio is coming. */
  end: string;
  /** Turns one server message into events; `done` when the service has finished. */
  onMessage(message: unknown): { events: SttEvent[]; done: boolean };
  /** Events still held when the service finishes, e.g. an Utterance it never closed. */
  onFinish(): SttEvent[];
}

/**
 * Streams audio over one WebSocket and yields events as they arrive, until the service
 * finishes. Throws if the connection fails or drops before the service finishes.
 */
export async function* streamOverSocket(
  connect: Connect,
  protocol: SocketProtocol,
  audio: AsyncIterable<Uint8Array>,
): AsyncGenerator<SttEvent> {
  const pending: SttEvent[] = [];
  let finished = false;
  let failure: Error | undefined;
  let wake: (() => void) | undefined;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  const host = new URL(protocol.url).host;
  const finish = () => {
    if (finished) return;
    finished = true;
    pending.push(...protocol.onFinish());
  };

  const ws = connect(protocol.url, protocol.protocols);
  ws.binaryType = 'arraybuffer';
  let opened = false;
  ws.addEventListener('open', () => {
    opened = true;
    if (protocol.start !== undefined) ws.send(protocol.start);
    void pump();
    notify();
  });
  ws.addEventListener('message', (event) => {
    if (finished || failure) return;
    try {
      const { events, done } = protocol.onMessage(JSON.parse(String(event.data)));
      pending.push(...events);
      if (done) {
        finish();
        ws.close();
      }
    } catch (err) {
      failure = err as Error;
      ws.close();
    }
    notify();
  });
  ws.addEventListener('close', (event) => {
    if (!finished && !failure) {
      if (!opened) failure = new Error(`Could not connect to ${host}: ${event.code} ${event.reason ?? ''}`);
      else if (event.code !== 1000) failure = new Error(`${host} closed the stream: ${event.code} ${event.reason ?? ''}`);
      else finish();
    }
    finished = true;
    notify();
  });
  ws.addEventListener('error', () => {
    failure ??= new Error(`Connection error on ${host}`);
    notify();
  });

  async function pump(): Promise<void> {
    try {
      for await (const chunk of audio) {
        if (finished || failure) return;
        ws.send(chunk);
      }
      if (!finished && !failure) ws.send(protocol.end);
    } catch (err) {
      failure ??= err as Error;
      ws.close();
      notify();
    }
  }

  try {
    while (true) {
      while (pending.length > 0) yield pending.shift()!;
      if (failure) throw failure;
      if (finished) return;
      await new Promise<void>((resolve) => (wake = resolve));
    }
  } finally {
    ws.close();
  }
}
