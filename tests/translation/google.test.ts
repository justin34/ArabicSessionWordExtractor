import { describe, expect, it } from 'vitest';
import { GoogleTranslator } from '../../src/core/translation/google';

interface Call {
  url: string;
  init: RequestInit;
}

/** A fake Google endpoint that answers every request with one fixed response. */
function fakeGoogle(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

const ok = (translatedText: string) => ({ data: { translations: [{ translatedText }] } });

describe('Google Cloud Translation', () => {
  it('asks for the Arabic sentence in English as plain text, with the key in a header', async () => {
    const google = fakeGoogle(200, ok('Welcome, everyone'));

    const text = await new GoogleTranslator({ apiKey: 'test-key', fetch: google.fetch }).translate(
      'مرحبا بكم',
    );

    expect(text).toBe('Welcome, everyone');
    expect(google.calls).toHaveLength(1);
    const [{ url, init }] = google.calls;
    expect(url).toBe('https://translation.googleapis.com/language/translate/v2');
    expect(url).not.toContain('test-key');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'X-Goog-Api-Key': 'test-key' });
    expect(JSON.parse(String(init.body))).toEqual({
      q: 'مرحبا بكم',
      source: 'ar',
      target: 'en',
      format: 'text',
    });
  });

  it('throws with Google’s message when the request is refused', async () => {
    const google = fakeGoogle(403, { error: { code: 403, message: 'API key not valid' } });

    await expect(
      new GoogleTranslator({ apiKey: 'bad', fetch: google.fetch }).translate('مرحبا'),
    ).rejects.toThrow(/403: API key not valid/);
  });

  it('throws when the reply holds no translation', async () => {
    const google = fakeGoogle(200, { data: { translations: [] } });

    await expect(
      new GoogleTranslator({ apiKey: 'k', fetch: google.fetch }).translate('مرحبا'),
    ).rejects.toThrow(/no translation/);
  });

  it('gives up on a reply slower than the timeout', async () => {
    const hanging = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) =>
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
      )) as unknown as typeof fetch;

    await expect(
      new GoogleTranslator({ apiKey: 'k', fetch: hanging, timeoutMs: 10 }).translate('مرحبا'),
    ).rejects.toThrow();
  });
});
