import { openAsBlob } from 'node:fs';
import type { RecordedAudio, RecordedSpeechToText, SttEvent, SttWord } from '../providers';
import { utteranceEvent } from './socket';
import { toWords } from './soniox';

/**
 * Speech-to-text for a whole recording (a completed Session's Mic Track): Soniox's async
 * API first, Deepgram's pre-recorded API as the fallback, the counterparts of the live
 * adapters. Neither service marks Utterances in a recording, so `segmentWords` splits the
 * words into them.
 */

/** A pause at least this long between two words ends an Utterance. */
export const UTTERANCE_PAUSE_MS = 1000;

/** A word ending a sentence: . ? ! ؟ or … (and the Arabic full stop ۔). */
const SENTENCE_END = /[.?!؟…۔]$/;

/** Splits a recording's words into final Utterances: at a sentence end, or a long pause. */
export function segmentWords(words: SttWord[], pauseMs = UTTERANCE_PAUSE_MS): SttEvent[] {
  const utterances: SttEvent[] = [];
  let open: SttWord[] = [];
  for (const word of words) {
    const last = open.at(-1);
    if (last && (SENTENCE_END.test(last.text) || word.startMs - last.endMs >= pauseMs)) {
      utterances.push(utteranceEvent('final', open));
      open = [];
    }
    open.push(word);
  }
  if (open.length > 0) utterances.push(utteranceEvent('final', open));
  return utterances;
}

const SONIOX_API = 'https://api.soniox.com/v1';

/** How often a Soniox transcription is asked whether it has finished. */
const POLL_MS = 3000;

interface SonioxTranscription {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  error_type?: string | null;
  error_message?: string | null;
}

interface SonioxTranscript {
  tokens?: Array<{ text: string; start_ms?: number; end_ms?: number }>;
}

export interface RecordedOptions {
  apiKey: string;
  /** Tests substitute a fake server. */
  fetch?: typeof fetch;
  /** How long to wait between status checks; tests shorten it. */
  pollMs?: number;
}

/** Why a service refused a request, said so the learner knows what to do. */
async function refusal(service: string, response: Response): Promise<Error> {
  const body = (await response.json().catch(() => ({}))) as { message?: string; err_msg?: string; error?: string };
  const detail = body.message ?? body.err_msg ?? body.error;
  const status = response.status;
  const why =
    status === 401 || status === 403
      ? `${service} refused the API key. Check it in Settings.`
      : status === 402
        ? `${service} says the account is out of balance.`
        : status === 429
          ? `${service} is busy. Try again in a minute.`
          : `${service} error ${status}.`;
  return new Error(detail ? `${why} (${detail})` : why);
}

/**
 * Soniox async transcription (`stt-async-v6`): upload the file, start a transcription,
 * poll until it finishes (a desktop app has no webhook URL), fetch the transcript, then
 * delete both the transcription and the file.
 */
export class SonioxRecordedSpeechToText implements RecordedSpeechToText {
  private readonly apiKey: string;
  private readonly fetch: typeof fetch;
  private readonly pollMs: number;

  constructor({ apiKey, fetch: fetchImpl = fetch, pollMs = POLL_MS }: RecordedOptions) {
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.pollMs = pollMs;
  }

  async transcribeFile(audio: RecordedAudio): Promise<SttWord[]> {
    const form = new FormData();
    form.append('file', await openAsBlob(audio.path, { type: audio.contentType }), fileName(audio));
    const file = await this.call<{ id: string }>('POST', '/files', form);
    let transcriptionId: string | undefined;
    try {
      const created = await this.call<SonioxTranscription>(
        'POST',
        '/transcriptions',
        JSON.stringify({
          model: 'stt-async-v6',
          file_id: file.id,
          language_hints: ['ar'],
          language_hints_strict: true,
        }),
      );
      transcriptionId = created.id;
      let job = created;
      while (job.status === 'queued' || job.status === 'processing') {
        await new Promise((resolve) => setTimeout(resolve, this.pollMs));
        job = await this.call<SonioxTranscription>('GET', `/transcriptions/${transcriptionId}`);
      }
      if (job.status === 'error') {
        throw new Error(`Soniox could not transcribe the recording: ${job.error_message || job.error_type || 'no reason given'}.`);
      }
      const transcript = await this.call<SonioxTranscript>('GET', `/transcriptions/${transcriptionId}/transcript`);
      return toWords(transcript.tokens ?? []);
    } finally {
      // Nothing is left on Soniox's side, whatever happened.
      if (transcriptionId) await this.call('DELETE', `/transcriptions/${transcriptionId}`).catch(() => undefined);
      await this.call('DELETE', `/files/${file.id}`).catch(() => undefined);
    }
  }

  private async call<T>(method: string, path: string, body?: FormData | string): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}` };
    if (typeof body === 'string') headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await this.fetch(`${SONIOX_API}${path}`, { method, headers, body });
    } catch (err) {
      throw new Error(`Could not reach Soniox (${(err as Error).message}). Check your internet connection.`);
    }
    if (!response.ok) throw await refusal('Soniox', response);
    return (response.status === 204 ? undefined : await response.json().catch(() => undefined)) as T;
  }
}

interface DeepgramResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{ words?: Array<{ word: string; punctuated_word?: string; start: number; end: number }> }>;
    }>;
  };
}

/**
 * Deepgram pre-recorded (Nova-3): the whole file in one request. Deepgram gives up on a
 * request that takes over 10 minutes to process, with a 504.
 */
export class DeepgramRecordedSpeechToText implements RecordedSpeechToText {
  private readonly apiKey: string;
  private readonly fetch: typeof fetch;

  constructor({ apiKey, fetch: fetchImpl = fetch }: RecordedOptions) {
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async transcribeFile(audio: RecordedAudio): Promise<SttWord[]> {
    const params = new URLSearchParams({ model: 'nova-3', language: 'ar', punctuate: 'true' });
    let response: Response;
    try {
      response = await this.fetch(`https://api.deepgram.com/v1/listen?${params}`, {
        method: 'POST',
        headers: { Authorization: `Token ${this.apiKey}`, 'Content-Type': audio.contentType },
        body: await openAsBlob(audio.path, { type: audio.contentType }),
      });
    } catch (err) {
      throw new Error(`Could not reach Deepgram (${(err as Error).message}). Check your internet connection.`);
    }
    if (response.status === 504) {
      throw new Error('Deepgram took more than 10 minutes over the recording and gave up. Try again later.');
    }
    if (!response.ok) throw await refusal('Deepgram', response);
    const result = (await response.json()) as DeepgramResponse;
    return (result.results?.channels?.[0]?.alternatives?.[0]?.words ?? []).map((w) => ({
      text: w.punctuated_word ?? w.word,
      startMs: Math.round(w.start * 1000),
      endMs: Math.round(w.end * 1000),
    }));
  }
}

function fileName(audio: RecordedAudio): string {
  return audio.path.split(/[\\/]/).at(-1) || 'recording';
}
