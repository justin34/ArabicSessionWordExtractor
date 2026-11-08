import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ApiKeys,
  KeyedSpeechToText,
  KeyedTranslator,
  NO_TRANSCRIPTION_KEY,
  NO_TRANSLATION_KEY,
} from '../src/core/apiKeys';
import type { SpeechToText, SttEvent } from '../src/core/providers';
import { parseApiKey, Settings, type SecretCodec } from '../src/core/settings';
import type { ApiKeyName } from '../src/core/types';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ill-keys-'));
  path = join(dir, 'settings.json');
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/** Stands in for the OS key store: reversible, and never the key as entered. */
const reversed: SecretCodec = {
  encode: (s) => `enc:${[...s].reverse().join('')}`,
  decode: (s) => {
    if (!s.startsWith('enc:')) throw new Error('not encrypted here');
    return [...s.slice(4)].reverse().join('');
  },
};

interface Call {
  url: string;
  init: RequestInit;
}

/** A fake of the services' HTTP endpoints, answering every request with `respond`. */
function fakeServer(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond(url, init);
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
const header = (call: Call, name: string) => (call.init.headers as Record<string, string>)[name];

describe('API keys in Settings', () => {
  it('are kept in settings.json across app runs, encoded, beside the audio settings', () => {
    const settings = new Settings(path, reversed);
    settings.setAudio({ desktopSource: null, microphone: { deviceId: 'h', label: 'Headset' } });
    new ApiKeys(settings).set('soniox', 'sk-live-1234');

    const reopened = new ApiKeys(new Settings(path, reversed));
    expect(reopened.get('soniox')).toBe('sk-live-1234');
    expect(readFileSync(path, 'utf8')).not.toContain('sk-live-1234');
    expect(new Settings(path, reversed).audio().microphone?.label).toBe('Headset');
  });

  it('report where each key comes from and its last four characters, never the key', () => {
    const keys = new ApiKeys(new Settings(path), { env: { GOOGLE_TRANSLATE_API_KEY: 'AIza-env-9876' } });
    keys.set('soniox', 'sk-abcd');

    expect(keys.status()).toEqual([
      { name: 'soniox', source: 'settings', hint: 'abcd' },
      { name: 'deepgram', source: null, hint: null },
      { name: 'googleTranslate', source: 'environment', hint: '9876' },
    ]);
  });

  it('a key entered in Settings wins over the environment, which fills in once it is removed', () => {
    const keys = new ApiKeys(new Settings(path), { env: { SONIOX_API_KEY: 'from-env' } });
    keys.set('soniox', 'from-settings');
    expect(keys.get('soniox')).toBe('from-settings');

    keys.set('soniox', null);
    expect(keys.get('soniox')).toBe('from-env');
  });

  it('a stored key that cannot be read back counts as missing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    writeFileSync(path, JSON.stringify({ apiKeys: { deepgram: 'not-encrypted' } }));
    const keys = new ApiKeys(new Settings(path, reversed));

    expect(keys.get('deepgram')).toBeUndefined();
    expect(keys.status()[1]).toEqual({ name: 'deepgram', source: null, hint: null });
  });

  it('are taken as pasted, without surrounding whitespace; a blank one removes the key', () => {
    expect(parseApiKey('  sk-123\n')).toBe('sk-123');
    expect(parseApiKey('   ')).toBeNull();
    expect(parseApiKey(null)).toBeNull();
    expect(parseApiKey('two words')).toBeUndefined();
    expect(parseApiKey(42)).toBeUndefined();
    expect(parseApiKey('x'.repeat(3000))).toBeUndefined();
  });
});

describe('Checking a key', () => {
  function keysWith(name: ApiKeyName, key: string, server: { fetch: typeof fetch }) {
    const keys = new ApiKeys(new Settings(path), { fetch: server.fetch, timeoutMs: 50 });
    keys.set(name, key);
    return keys;
  }

  it('asks Soniox for its models with the key as a bearer token', async () => {
    const server = fakeServer(() => json(200, { models: [] }));
    const check = await keysWith('soniox', 'sk-1', server).check('soniox');

    expect(check).toEqual({ ok: true, message: 'Soniox accepted the key.' });
    expect(server.calls[0].url).toBe('https://api.soniox.com/v1/models');
    expect(header(server.calls[0], 'Authorization')).toBe('Bearer sk-1');
  });

  it('asks Deepgram for its projects with the key as a token', async () => {
    const server = fakeServer(() => json(200, { projects: [] }));
    const check = await keysWith('deepgram', 'dg-1', server).check('deepgram');

    expect(check.ok).toBe(true);
    expect(server.calls[0].url).toBe('https://api.deepgram.com/v1/projects');
    expect(header(server.calls[0], 'Authorization')).toBe('Token dg-1');
  });

  it('translates one word with Google, the key in a header and never the URL', async () => {
    const server = fakeServer(() => json(200, { data: { translations: [{ translatedText: 'hello' }] } }));
    const check = await keysWith('googleTranslate', 'AIza-1', server).check('googleTranslate');

    expect(check.ok).toBe(true);
    expect(server.calls[0].url).not.toContain('AIza-1');
    expect(header(server.calls[0], 'X-Goog-Api-Key')).toBe('AIza-1');
  });

  it('a refused key says where to get a working one', async () => {
    const server = fakeServer(() => json(401, { error: 'unauthorized' }));
    const soniox = await keysWith('soniox', 'bad', server).check('soniox');
    const deepgram = await keysWith('deepgram', 'bad', server).check('deepgram');

    expect(soniox).toMatchObject({ ok: false, problem: 'invalid' });
    expect(soniox.message).toMatch(/Soniox refused this key.*Soniox Console \(console\.soniox\.com/);
    expect(deepgram.message).toMatch(/Deepgram refused this key.*console\.deepgram\.com/);
  });

  it('a Google key that is not valid says how to create one', async () => {
    const server = fakeServer(() =>
      json(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } }),
    );
    const check = await keysWith('googleTranslate', 'bad', server).check('googleTranslate');

    expect(check).toMatchObject({ ok: false, problem: 'invalid' });
    expect(check.message).toMatch(/Google Cloud Translation refused this key.*Credentials.*Cloud Translation API enabled/);
  });

  it('a Google key whose project cannot translate says to enable the API, quoting Google', async () => {
    const server = fakeServer(() =>
      json(403, { error: { code: 403, message: 'Cloud Translation API has not been used in project 1 before or it is disabled.' } }),
    );
    const check = await keysWith('googleTranslate', 'AIza', server).check('googleTranslate');

    expect(check).toMatchObject({ ok: false, problem: 'invalid' });
    expect(check.message).toMatch(/Enable the Cloud Translation API/);
    expect(check.message).toMatch(/has not been used in project 1/);
  });

  it('a Deepgram key without permission says which role it needs', async () => {
    const check = await keysWith('deepgram', 'dg', fakeServer(() => json(403))).check('deepgram');
    expect(check.message).toMatch(/lacks permission.*Member role/);
  });

  it('offline or a service outage is not called a bad key, and the key is kept', async () => {
    const keys = keysWith('soniox', 'sk', fakeServer(() => Promise.reject(new TypeError('fetch failed'))));
    const down = await keysWith('deepgram', 'dg', fakeServer(() => json(503))).check('deepgram');

    const check = await keys.check('soniox');
    expect(check).toMatchObject({ ok: false, problem: 'unreachable' });
    expect(check.message).toMatch(/Could not reach Soniox \(fetch failed\).*internet connection.*key is kept/);
    expect(keys.get('soniox')).toBe('sk');
    expect(down).toMatchObject({ ok: false, problem: 'unreachable' });
    expect(down.message).toMatch(/error 503.*Try again/);
  });

  it('gives up on a service that does not answer in time', async () => {
    const hanging = fakeServer(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );
    const check = await keysWith('soniox', 'sk', hanging).check('soniox');

    expect(check).toMatchObject({ ok: false, problem: 'unreachable' });
    expect(check.message).toMatch(/no answer in time/);
  });

  it('with no key set, says how to get one without asking the service', async () => {
    const server = fakeServer(() => json(200));
    const check = await new ApiKeys(new Settings(path), { fetch: server.fetch }).check('googleTranslate');

    expect(check).toMatchObject({ ok: false, problem: 'missing' });
    expect(check.message).toMatch(/No Google Cloud Translation key/);
    expect(server.calls).toHaveLength(0);
  });
});

/** Records which key each provider made was given. */
function recordingMakers() {
  const made: string[] = [];
  const stt =
    (label: string) =>
    (key: string): SpeechToText => {
      made.push(`${label}:${key}`);
      return {
        async *transcribe(): AsyncIterable<SttEvent> {
          // No speech.
        },
      };
    };
  return { made, make: { soniox: stt('soniox'), deepgram: stt('deepgram') } };
}

async function* noAudio(): AsyncIterable<Uint8Array> {
  // Nothing recorded.
}

async function drain(events: AsyncIterable<SttEvent>): Promise<void> {
  for await (const _ of events) {
    // Drain.
  }
}

describe('Providers using the keys', () => {
  it('speech-to-text uses Soniox when it has a key, else Deepgram, with the key set when each Session starts', async () => {
    const keys = new ApiKeys(new Settings(path));
    const { made, make } = recordingMakers();
    const stt = new KeyedSpeechToText(keys, make);

    keys.set('deepgram', 'dg-1');
    await drain(stt.transcribe(noAudio()));
    keys.set('soniox', 'sk-1');
    await drain(stt.transcribe(noAudio()));
    keys.set('soniox', 'sk-2');
    await drain(stt.transcribe(noAudio()));

    expect(made).toEqual(['deepgram:dg-1', 'soniox:sk-1', 'soniox:sk-2']);
  });

  it('speech-to-text without a key fails at once, saying to add one in Settings', async () => {
    const stt = new KeyedSpeechToText(new ApiKeys(new Settings(path)));
    await expect(drain(stt.transcribe(noAudio()))).rejects.toThrow(NO_TRANSCRIPTION_KEY);
  });

  it('translation uses the key set for each sentence, and without one fails saying so', async () => {
    const keys = new ApiKeys(new Settings(path));
    const used: string[] = [];
    const translator = new KeyedTranslator(keys, (key) => ({
      translate: async () => {
        used.push(key);
        return 'Hello';
      },
    }));

    await expect(translator.translate('مرحبا')).rejects.toThrow(NO_TRANSLATION_KEY);
    keys.set('googleTranslate', 'AIza-1');
    expect(await translator.translate('مرحبا')).toBe('Hello');
    expect(used).toEqual(['AIza-1']);
  });
});
