/** Deepgram Nova-3 live streaming adapter. */
import { runSocket, type AudioFormat, type SpikeEvent, type StreamingStt } from './stream.ts';

export function deepgramUrl({ sampleRate, channels, language }: AudioFormat, model = 'nova-3'): string {
  const params = new URLSearchParams({
    model,
    language,
    encoding: 'linear16',
    sample_rate: String(sampleRate),
    channels: String(channels),
    interim_results: 'true',
    punctuate: 'true',
  });
  return `wss://api.deepgram.com/v1/listen?${params}`;
}

interface DeepgramResults {
  type?: string;
  start?: number;
  duration?: number;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: { transcript?: string; words?: { start: number; end: number }[] }[] };
}

export function parseDeepgramMessage(message: unknown): SpikeEvent | null {
  const results = message as DeepgramResults;
  if (results.type !== 'Results') return null;
  const alternative = results.channel?.alternatives?.[0];
  const text = alternative?.transcript ?? '';
  const isFinal = results.is_final === true;
  if (text === '' && !isFinal) return null;
  const words = alternative?.words ?? [];
  const start = words.length > 0 ? words[0].start : (results.start ?? 0);
  const end = words.length > 0 ? words[words.length - 1].end : (results.start ?? 0) + (results.duration ?? 0);
  return {
    type: isFinal ? 'final' : 'interim',
    text,
    startMs: Math.round(start * 1000),
    endMs: Math.round(end * 1000),
    endpoint: results.speech_final === true,
  };
}

export class DeepgramStt implements StreamingStt {
  readonly name = 'deepgram';
  readonly finalSeparator = ' ';
  /** Nova-3 monolingual streaming, $0.0077/min on deepgram.com/pricing, checked 2026-11-07. */
  readonly usdPerHour = 0.0077 * 60;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model = 'nova-3') {
    this.apiKey = apiKey;
    this.model = model;
  }

  transcribe(frames: AsyncIterable<Uint8Array>, format: AudioFormat): AsyncIterable<SpikeEvent> {
    return runSocket({
      url: deepgramUrl(format, this.model),
      protocols: ['token', this.apiKey],
      frames,
      end: JSON.stringify({ type: 'CloseStream' }),
      onMessage: (message) => {
        const event = parseDeepgramMessage(message);
        return { events: event ? [event] : [], done: false };
      },
    });
  }
}
