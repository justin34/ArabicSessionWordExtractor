import type { Translator } from '../providers';

const GOOGLE_TRANSLATE_URL = 'https://translation.googleapis.com/language/translate/v2';

/** A slow answer must not hold a Session's stop for long; the Utterance keeps no translation. */
const DEFAULT_TIMEOUT_MS = 10_000;

interface GoogleResponse {
  data?: { translations?: Array<{ translatedText?: string }> };
  error?: { code?: number; message?: string };
}

export interface GoogleTranslatorOptions {
  apiKey: string;
  /** Tests substitute a fake server. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Google Cloud Translation (Basic, v2): one Arabic sentence in, one English sentence out.
 * The key goes in a header, never the URL. Throws on any failure; the Session pipeline
 * decides what a failed translation means.
 */
export class GoogleTranslator implements Translator {
  private readonly apiKey: string;
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor({ apiKey, fetch: fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }: GoogleTranslatorOptions) {
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async translate(arabic: string): Promise<string> {
    const response = await this.fetch(GOOGLE_TRANSLATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.apiKey },
      // 'text' keeps the reply plain: no HTML entities to decode.
      body: JSON.stringify({ q: arabic, source: 'ar', target: 'en', format: 'text' }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = (await response.json().catch(() => ({}))) as GoogleResponse;
    if (!response.ok) {
      throw new Error(
        `Google Translation error ${body.error?.code ?? response.status}: ${body.error?.message ?? ''}`,
      );
    }
    const text = body.data?.translations?.[0]?.translatedText;
    if (typeof text !== 'string') throw new Error('Google Translation returned no translation');
    return text;
  }
}
