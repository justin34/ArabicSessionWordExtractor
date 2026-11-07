/** Soniox real-time adapter. */
import { runSocket, type AudioFormat, type SpikeEvent, type StreamingStt } from './stream.ts';

export const SONIOX_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';

export function sonioxConfig({ sampleRate, channels, language }: AudioFormat, model = 'stt-rt-v6') {
  return {
    model,
    audio_format: 'pcm_s16le',
    sample_rate: sampleRate,
    num_channels: channels,
    language_hints: [language],
    language_hints_strict: true,
    enable_endpoint_detection: true,
  };
}

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

/**
 * Soniox sends tokens (often sub-word pieces), each final exactly once. This turns
 * each response into at most one final event (the newly final tokens) and one
 * interim event (the still-pending tokens). Final texts concatenate without separators.
 */
export class SonioxAssembler {
  private lastFinalEndMs = 0;

  feed(message: unknown): SpikeEvent[] {
    const response = message as SonioxResponse;
    if (response.error_code !== undefined) {
      throw new Error(`Soniox error ${response.error_code}: ${response.error_message ?? ''}`);
    }
    const tokens = response.tokens ?? [];
    const endpoint = tokens.some((t) => t.text === '<end>');
    const speech = tokens.filter((t) => !CONTROL_TOKEN.test(t.text));
    const finals = speech.filter((t) => t.is_final);
    const interims = speech.filter((t) => !t.is_final);
    const events: SpikeEvent[] = [];

    if (finals.length > 0 || endpoint) {
      const startMs = finals[0]?.start_ms ?? this.lastFinalEndMs;
      if (finals.length > 0) this.lastFinalEndMs = finals[finals.length - 1].end_ms ?? this.lastFinalEndMs;
      events.push({
        type: 'final',
        text: finals.map((t) => t.text).join(''),
        startMs,
        endMs: this.lastFinalEndMs,
        endpoint,
      });
    }
    if (interims.length > 0) {
      events.push({
        type: 'interim',
        text: interims.map((t) => t.text).join(''),
        startMs: interims[0].start_ms ?? 0,
        endMs: interims[interims.length - 1].end_ms ?? 0,
        endpoint: false,
      });
    }
    return events;
  }
}

export class SonioxStt implements StreamingStt {
  readonly name = 'soniox';
  readonly finalSeparator = '';
  /** Token-priced; soniox.com/pricing gives "about $0.12/hour" real-time, checked 2026-11-07. */
  readonly usdPerHour = 0.12;
  private readonly apiKey: string;
  private readonly model: string;
  /** Extra start-request fields, e.g. endpoint tuning: { endpoint_sensitivity: 0.5 }. */
  private readonly overrides: Record<string, unknown>;

  constructor(apiKey: string, { model = 'stt-rt-v6', overrides = {} }: { model?: string; overrides?: Record<string, unknown> } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.overrides = overrides;
  }

  transcribe(frames: AsyncIterable<Uint8Array>, format: AudioFormat): AsyncIterable<SpikeEvent> {
    const assembler = new SonioxAssembler();
    return runSocket({
      url: SONIOX_URL,
      protocols: ['soniox-api-key', this.apiKey],
      start: JSON.stringify({ ...sonioxConfig(format, this.model), ...this.overrides }),
      frames,
      end: '',
      onMessage: (message) => ({
        events: assembler.feed(message),
        done: (message as SonioxResponse).finished === true,
      }),
    });
  }
}
