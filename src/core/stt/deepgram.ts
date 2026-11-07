import type { SpeechToText, SttEvent, SttWord } from '../providers';
import { connectWebSocket, streamOverSocket, type Connect } from './socket';

/** No `encoding`: the Desktop Track is WebM/Opus, which Deepgram detects itself. */
const PARAMS = {
  model: 'nova-3',
  language: 'ar',
  interim_results: 'true',
  punctuate: 'true',
  // Sends UtteranceEnd after 1 s without words, closing an Utterance speech_final missed.
  utterance_end_ms: '1000',
};

interface DeepgramMessage {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: {
    alternatives?: Array<{
      words?: Array<{ word: string; punctuated_word?: string; start: number; end: number }>;
    }>;
  };
}

function utterance(type: SttEvent['type'], words: SttWord[]): SttEvent {
  const event: SttEvent = {
    type,
    text: words.map((w) => w.text).join(' '),
    startMs: words[0]?.startMs ?? 0,
    endMs: words.at(-1)?.endMs ?? 0,
  };
  return type === 'final' ? { ...event, words } : event;
}

/**
 * Deepgram finalizes a stream in segments (`is_final`) and marks the end of speech with
 * `speech_final` or a later UtteranceEnd. This holds the final segments of the open
 * Utterance and turns each message into whole-Utterance events.
 */
class DeepgramAssembler {
  private finals: SttWord[] = [];

  feed(message: unknown): { events: SttEvent[]; done: boolean } {
    const m = message as DeepgramMessage;
    if (m.type === 'UtteranceEnd') return { events: this.close(), done: false };
    if (m.type !== 'Results') return { events: [], done: false };

    const words: SttWord[] = (m.channel?.alternatives?.[0]?.words ?? []).map((w) => ({
      text: w.punctuated_word ?? w.word,
      startMs: Math.round(w.start * 1000),
      endMs: Math.round(w.end * 1000),
    }));
    if (!m.is_final) {
      const open = [...this.finals, ...words];
      return { events: open.length > 0 ? [utterance('interim', open)] : [], done: false };
    }
    this.finals.push(...words);
    if (m.speech_final) return { events: this.close(), done: false };
    return { events: this.finals.length > 0 ? [utterance('interim', this.finals)] : [], done: false };
  }

  /** Closes the open Utterance, if it has any words. */
  close(): SttEvent[] {
    const words = this.finals;
    this.finals = [];
    return words.length > 0 ? [utterance('final', words)] : [];
  }
}

export interface DeepgramOptions {
  apiKey: string;
  connect?: Connect;
}

/** Deepgram Nova-3 live streaming: the fallback speech-to-text adapter. */
export class DeepgramSpeechToText implements SpeechToText {
  private readonly apiKey: string;
  private readonly connect: Connect;

  constructor({ apiKey, connect = connectWebSocket }: DeepgramOptions) {
    this.apiKey = apiKey;
    this.connect = connect;
  }

  transcribe(audio: AsyncIterable<Uint8Array>): AsyncIterable<SttEvent> {
    const assembler = new DeepgramAssembler();
    return streamOverSocket(
      this.connect,
      {
        url: `wss://api.deepgram.com/v1/listen?${new URLSearchParams(PARAMS)}`,
        protocols: ['token', this.apiKey],
        end: JSON.stringify({ type: 'CloseStream' }),
        // Deepgram finishes by closing the socket normally after CloseStream.
        onMessage: (message) => assembler.feed(message),
        onFinish: () => assembler.close(),
      },
      audio,
    );
  }
}
