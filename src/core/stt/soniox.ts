import type { SpeechToText, SttEvent, SttWord } from '../providers';
import { connectWebSocket, streamOverSocket, type Connect } from './socket';

const SONIOX_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';

/**
 * Start request. The Desktop Track is WebM/Opus, which Soniox detects itself.
 * max_endpoint_delay_ms 1000 trades a little accuracy for much earlier finals (spike #3).
 */
const CONFIG = {
  model: 'stt-rt-v6',
  audio_format: 'auto',
  language_hints: ['ar'],
  language_hints_strict: true,
  enable_endpoint_detection: true,
  max_endpoint_delay_ms: 1000,
};

interface SonioxToken {
  text: string;
  start_ms?: number;
  end_ms?: number;
  is_final: boolean;
}

interface SonioxResponse {
  tokens?: SonioxToken[];
  finished?: boolean;
  error_code?: number;
  error_message?: string;
}

/** `<end>` closes an Utterance; `<fin>` answers a manual finalize. Neither is speech. */
const CONTROL_TOKEN = /^<\w+>$/;
const END_TOKEN = '<end>';

/** Joins sub-word tokens into words: a token with leading whitespace starts a new word. */
function toWords(tokens: SonioxToken[]): SttWord[] {
  const words: SttWord[] = [];
  for (const t of tokens) {
    const last = words.at(-1);
    if (last && !/^\s/.test(t.text)) {
      last.text += t.text;
      last.endMs = t.end_ms ?? last.endMs;
    } else if (t.text.trim()) {
      words.push({ text: t.text.trim(), startMs: t.start_ms ?? 0, endMs: t.end_ms ?? 0 });
    }
  }
  return words;
}

function utterance(type: SttEvent['type'], tokens: SonioxToken[]): SttEvent {
  const words = toWords(tokens);
  const event: SttEvent = {
    type,
    text: words.map((w) => w.text).join(' '),
    startMs: words[0]?.startMs ?? 0,
    endMs: words.at(-1)?.endMs ?? 0,
  };
  return type === 'final' ? { ...event, words } : event;
}

/**
 * Soniox sends each token final exactly once, and marks the end of an Utterance with
 * `<end>`. This holds the final tokens of the open Utterance and turns each response
 * into whole-Utterance events: interim while it grows, final at `<end>`.
 */
class SonioxAssembler {
  private finals: SonioxToken[] = [];

  feed(message: unknown): { events: SttEvent[]; done: boolean } {
    const response = message as SonioxResponse;
    if (response.error_code !== undefined) {
      throw new Error(`Soniox error ${response.error_code}: ${response.error_message ?? ''}`);
    }
    const events: SttEvent[] = [];
    const interims: SonioxToken[] = [];
    for (const t of response.tokens ?? []) {
      if (t.text === END_TOKEN) {
        events.push(...this.close());
      } else if (!CONTROL_TOKEN.test(t.text)) {
        if (t.is_final) this.finals.push(t);
        else interims.push(t);
      }
    }
    const open = [...this.finals, ...interims];
    if (open.some((t) => t.text.trim())) events.push(utterance('interim', open));
    return { events, done: response.finished === true };
  }

  /** Closes the open Utterance, if it has any speech. */
  close(): SttEvent[] {
    const tokens = this.finals;
    this.finals = [];
    return tokens.some((t) => t.text.trim()) ? [utterance('final', tokens)] : [];
  }
}

export interface SonioxOptions {
  apiKey: string;
  connect?: Connect;
}

/** Soniox real-time streaming: the first speech-to-text adapter. */
export class SonioxSpeechToText implements SpeechToText {
  private readonly apiKey: string;
  private readonly connect: Connect;

  constructor({ apiKey, connect = connectWebSocket }: SonioxOptions) {
    this.apiKey = apiKey;
    this.connect = connect;
  }

  transcribe(audio: AsyncIterable<Uint8Array>): AsyncIterable<SttEvent> {
    const assembler = new SonioxAssembler();
    return streamOverSocket(
      this.connect,
      {
        url: SONIOX_URL,
        protocols: ['soniox-api-key', this.apiKey],
        start: JSON.stringify(CONFIG),
        end: '',
        onMessage: (message) => assembler.feed(message),
        onFinish: () => assembler.close(),
      },
      audio,
    );
  }
}
