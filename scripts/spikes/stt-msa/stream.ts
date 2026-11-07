/**
 * The spike's provider seam. Each adapter streams raw PCM to one cloud service and
 * yields the app's SttEvent (src/core/providers.ts), plus an `endpoint` flag marking
 * where the service closed an Utterance, so latency can be measured per Utterance too.
 */
import type { SttEvent } from '../../../src/core/providers.ts';

export interface SpikeEvent extends SttEvent {
  /** True when the service says the Utterance ended here (Deepgram speech_final, Soniox <end>). */
  endpoint: boolean;
}

export interface AudioFormat {
  sampleRate: number;
  channels: number;
  /** Language code sent to the service, e.g. "ar". */
  language: string;
}

export interface StreamingStt {
  readonly name: string;
  /** How this service's final texts join into one transcript (Soniox finals can split a word). */
  readonly finalSeparator: string;
  /** Pay-as-you-go streaming list price, for the cost column. */
  readonly usdPerHour: number;
  transcribe(frames: AsyncIterable<Uint8Array>, format: AudioFormat): AsyncIterable<SpikeEvent>;
}

interface SocketSession {
  url: string;
  protocols: string[];
  /** Text frame sent once the socket opens, before any audio. */
  start?: string;
  frames: AsyncIterable<Uint8Array>;
  /** Text frame that tells the service no more audio is coming. */
  end: string;
  onMessage(message: unknown): { events: SpikeEvent[]; done: boolean };
}

/** Streams frames over one WebSocket and yields events as they arrive, until the service finishes. */
export async function* runSocket(session: SocketSession): AsyncGenerator<SpikeEvent> {
  const pending: SpikeEvent[] = [];
  let finished = false;
  let failure: Error | undefined;
  let wake: (() => void) | undefined;
  const notify = () => {
    wake?.();
    wake = undefined;
  };

  const ws = new WebSocket(session.url, session.protocols);
  ws.binaryType = 'arraybuffer';
  const opened = new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('close', (event) => reject(new Error(`could not connect: ${event.code} ${event.reason}`)), {
      once: true,
    });
  });
  ws.addEventListener('message', (event) => {
    if (finished) return;
    try {
      const { events, done } = session.onMessage(JSON.parse(String(event.data)));
      pending.push(...events);
      if (done) {
        finished = true;
        ws.close();
      }
    } catch (error) {
      failure = error as Error;
      ws.close();
    }
    notify();
  });
  ws.addEventListener('close', (event) => {
    if (!finished && !failure && event.code !== 1000) {
      failure = new Error(`socket closed with ${event.code} ${event.reason}`);
    }
    finished = true;
    notify();
  });
  ws.addEventListener('error', () => {
    failure ??= new Error(`socket error on ${new URL(session.url).host}`);
    notify();
  });

  await opened;
  if (session.start !== undefined) ws.send(session.start);

  void (async () => {
    try {
      for await (const frame of session.frames) {
        if (finished || failure) return;
        ws.send(frame as Uint8Array<ArrayBuffer>);
      }
      ws.send(session.end);
    } catch (error) {
      failure = error as Error;
      ws.close();
      notify();
    }
  })();

  while (true) {
    while (pending.length > 0) yield pending.shift()!;
    if (failure) throw failure;
    if (finished) return;
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
  }
}
