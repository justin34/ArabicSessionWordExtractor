import type { SpeechToText, SttEvent, Translator } from './providers';
import { API_KEY_NAMES, type Settings } from './settings';
import { DeepgramSpeechToText } from './stt/deepgram';
import { SonioxSpeechToText } from './stt/soniox';
import { GoogleTranslator } from './translation/google';
import type { ApiKeyCheck, ApiKeyName, ApiKeyStatus } from './types';

/** Environment variables that set a key when the settings screen has none (dev, CI). */
export const API_KEY_ENV_VARS: Record<ApiKeyName, string> = {
  soniox: 'SONIOX_API_KEY',
  deepgram: 'DEEPGRAM_API_KEY',
  googleTranslate: 'GOOGLE_TRANSLATE_API_KEY',
};

const SERVICE: Record<ApiKeyName, string> = {
  soniox: 'Soniox',
  deepgram: 'Deepgram',
  googleTranslate: 'Google Cloud Translation',
};

/** Where each service hands out keys, for the messages that say how to fix one. */
const GET_A_KEY: Record<ApiKeyName, string> = {
  soniox: 'Copy an API key from the Soniox Console (console.soniox.com, API keys)',
  deepgram: 'Create an API key in the Deepgram Console (console.deepgram.com, API Keys)',
  googleTranslate:
    'Create an API key in the Google Cloud console (APIs & Services, Credentials) for a project with the Cloud Translation API enabled',
};

export const NO_TRANSCRIPTION_KEY =
  'No speech-to-text key: audio is recorded without a Transcript. Add a Soniox or Deepgram key in Settings.';
export const NO_TRANSLATION_KEY =
  'No Google Cloud Translation key: sentences are not translated. Add one in Settings.';

const CHECK_TIMEOUT_MS = 10_000;

/** A provider whose key is missing: it fails as soon as it is used, saying how to fix it. */
class MissingKeyError extends Error {}

export interface ApiKeysOptions {
  /** Environment variables to fall back on; none by default. */
  env?: Record<string, string | undefined>;
  /** Tests substitute a fake server. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * The API keys the providers use: the one entered in Settings, else its environment
 * variable. Each is read again whenever a provider is used, so a key entered or changed
 * applies from the next Session (speech-to-text) or the next sentence (translation).
 */
export class ApiKeys {
  private readonly env: Record<string, string | undefined>;
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    private readonly settings: Settings,
    { env = {}, fetch: fetchImpl = fetch, timeoutMs = CHECK_TIMEOUT_MS }: ApiKeysOptions = {},
  ) {
    this.env = env;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  get(name: ApiKeyName): string | undefined {
    return this.settings.apiKey(name) ?? (this.env[API_KEY_ENV_VARS[name]]?.trim() || undefined);
  }

  status(): ApiKeyStatus[] {
    return API_KEY_NAMES.map((name) => {
      const fromSettings = this.settings.apiKey(name) !== undefined;
      const key = this.get(name);
      return {
        name,
        source: key === undefined ? null : fromSettings ? 'settings' : 'environment',
        hint: key === undefined ? null : key.slice(-4),
      };
    });
  }

  /** Stores a key entered in Settings, or removes it with null. */
  set(name: ApiKeyName, key: string | null): ApiKeyStatus[] {
    this.settings.setApiKey(name, key);
    return this.status();
  }

  /** Tries the key in use against its service, without recording anything. */
  async check(name: ApiKeyName): Promise<ApiKeyCheck> {
    const key = this.get(name);
    if (key === undefined) return { ok: false, problem: 'missing', message: `No ${SERVICE[name]} key. ${GET_A_KEY[name]}, and paste it here.` };
    let response: Response;
    try {
      response = await this.fetch(...checkRequest(name, key, this.timeoutMs));
    } catch (err) {
      const reason = (err as Error).name === 'TimeoutError' ? 'no answer in time' : (err as Error).message;
      return {
        ok: false,
        problem: 'unreachable',
        message: `Could not reach ${SERVICE[name]} (${reason}). Check your internet connection and try again; the key is kept.`,
      };
    }
    return checkResult(name, response);
  }
}

function checkRequest(name: ApiKeyName, key: string, timeoutMs: number): [string, RequestInit] {
  const signal = AbortSignal.timeout(timeoutMs);
  switch (name) {
    case 'soniox':
      return ['https://api.soniox.com/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal }];
    case 'deepgram':
      return ['https://api.deepgram.com/v1/projects', { headers: { Authorization: `Token ${key}` }, signal }];
    case 'googleTranslate':
      return [
        'https://translation.googleapis.com/language/translate/v2',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
          body: JSON.stringify({ q: 'مرحبا', source: 'ar', target: 'en', format: 'text' }),
          signal,
        },
      ];
  }
}

async function checkResult(name: ApiKeyName, response: Response): Promise<ApiKeyCheck> {
  const service = SERVICE[name];
  if (response.ok) return { ok: true, message: `${service} accepted the key.` };
  const status = response.status;
  if (status === 429 || status >= 500) {
    return {
      ok: false,
      problem: 'unreachable',
      message: `${service} could not check the key just now (error ${status}). Try again in a minute; the key is kept.`,
    };
  }
  if (name === 'googleTranslate' && status === 403) {
    // The key is real, but its project or restrictions do not allow translation.
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    const detail = body.error?.message ? ` (Google says: ${body.error.message})` : '';
    return {
      ok: false,
      problem: 'invalid',
      message: `Google accepted the key but will not translate with it${detail}. Enable the Cloud Translation API for the key's project, and if the key has API restrictions, allow the Cloud Translation API.`,
    };
  }
  if (name === 'deepgram' && status === 403) {
    return {
      ok: false,
      problem: 'invalid',
      message: `Deepgram knows this key but it lacks permission. ${GET_A_KEY.deepgram} with the Member role, and paste it here.`,
    };
  }
  return {
    ok: false,
    problem: 'invalid',
    message: `${service} refused this key (error ${status}). ${GET_A_KEY[name]}, and paste it here in full.`,
  };
}

async function* failing(error: Error): AsyncGenerator<SttEvent> {
  throw error;
}

/**
 * Speech-to-text with the key in use when each Session starts: Soniox first, Deepgram
 * as the fallback (GLOSSARY, STT provider). Without either, it fails at once, and the
 * Session records audio without a Transcript.
 */
export class KeyedSpeechToText implements SpeechToText {
  constructor(
    private readonly keys: Pick<ApiKeys, 'get'>,
    private readonly make = {
      soniox: (apiKey: string): SpeechToText => new SonioxSpeechToText({ apiKey }),
      deepgram: (apiKey: string): SpeechToText => new DeepgramSpeechToText({ apiKey }),
    },
  ) {}

  transcribe(audio: AsyncIterable<Uint8Array>): AsyncIterable<SttEvent> {
    const soniox = this.keys.get('soniox');
    if (soniox) return this.make.soniox(soniox).transcribe(audio);
    const deepgram = this.keys.get('deepgram');
    if (deepgram) return this.make.deepgram(deepgram).transcribe(audio);
    return failing(new MissingKeyError(NO_TRANSCRIPTION_KEY));
  }
}

/** Google Cloud Translation with the key in use; without one, each translation fails saying so. */
export class KeyedTranslator implements Translator {
  constructor(
    private readonly keys: Pick<ApiKeys, 'get'>,
    private readonly make = (apiKey: string): Translator => new GoogleTranslator({ apiKey }),
  ) {}

  async translate(arabic: string): Promise<string> {
    const key = this.keys.get('googleTranslate');
    if (!key) throw new MissingKeyError(NO_TRANSLATION_KEY);
    return this.make(key).translate(arabic);
  }
}
