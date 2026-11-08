import { useEffect, useState } from 'react';
import type { ApiKeyCheck, ApiKeyName, ApiKeyStatus } from '../bridge';

const KEYS: Array<{ name: ApiKeyName; label: string; use: string; env: string }> = [
  { name: 'soniox', label: 'Soniox', use: 'Speech-to-text. Used when set.', env: 'SONIOX_API_KEY' },
  {
    name: 'deepgram',
    label: 'Deepgram',
    use: 'Speech-to-text fallback, used when there is no Soniox key.',
    env: 'DEEPGRAM_API_KEY',
  },
  {
    name: 'googleTranslate',
    label: 'Google Cloud Translation',
    use: 'Translates each sentence into English.',
    env: 'GOOGLE_TRANSLATE_API_KEY',
  },
];

export type LoadKeys = () => Promise<ApiKeyStatus[]>;
export type SaveKey = (name: ApiKeyName, key: string | null) => Promise<ApiKeyStatus[]>;
export type CheckKey = (name: ApiKeyName) => Promise<ApiKeyCheck>;

type Result = { kind: 'checking' } | { kind: 'ok'; text: string } | { kind: 'error'; text: string };

function describe(status: ApiKeyStatus | undefined, env: string): string {
  if (!status?.source) return 'Not set.';
  const ending = status.hint ? `, ending …${status.hint}` : '';
  return status.source === 'settings' ? `Saved${ending}.` : `Set by ${env} in the environment${ending}.`;
}

function KeyField({
  name,
  label,
  use,
  env,
  status,
  onChange,
  saveKey,
  checkKey,
}: (typeof KEYS)[number] & {
  status: ApiKeyStatus | undefined;
  onChange: (statuses: ApiKeyStatus[]) => void;
  saveKey: SaveKey;
  checkKey: CheckKey;
}) {
  const [draft, setDraft] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const inputId = `api-key-${name}`;

  async function check(): Promise<void> {
    setResult({ kind: 'checking' });
    try {
      const outcome = await checkKey(name);
      setResult(outcome.ok ? { kind: 'ok', text: outcome.message } : { kind: 'error', text: outcome.message });
    } catch (err) {
      setResult({ kind: 'error', text: `Could not check the key: ${(err as Error).message}` });
    }
  }

  async function save(key: string | null): Promise<void> {
    try {
      onChange(await saveKey(name, key));
    } catch (err) {
      setResult({ kind: 'error', text: `Could not save the key: ${(err as Error).message}` });
      return;
    }
    setDraft('');
    if (key === null) setResult({ kind: 'ok', text: 'Key removed.' });
    // A saved key is tried at once, so a mistake shows before a Session needs it.
    else await check();
  }

  return (
    <form
      className="settings__field settings__key"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim()) void save(draft);
      }}
    >
      <label htmlFor={inputId}>{label} API key</label>
      <p className="settings__note">
        {use} {describe(status, env)}
      </p>
      <div className="settings__key-row">
        <input
          id={inputId}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={status?.source ? 'Paste a new key to replace it' : 'Paste the key'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn btn--primary" disabled={!draft.trim()} aria-label={`Save ${label} key`}>
          Save
        </button>
      </div>
      {status?.source && (
        <div className="settings__key-actions">
          <button
            type="button"
            className="btn"
            onClick={() => void check()}
            disabled={result?.kind === 'checking'}
            aria-label={`Check ${label} key`}
          >
            Check key
          </button>
          {status.source === 'settings' && (
            <button
              type="button"
              className="btn btn--link"
              onClick={() => void save(null)}
              aria-label={`Remove ${label} key`}
            >
              Remove
            </button>
          )}
        </div>
      )}
      {result && (
        <p
          className={`settings__status settings__status--${result.kind === 'ok' ? 'saved' : result.kind === 'error' ? 'error' : 'pending'}`}
          role={result.kind === 'error' ? 'alert' : 'status'}
        >
          {result.kind === 'checking' ? `Checking the ${label} key…` : result.text}
        </p>
      )}
    </form>
  );
}

/** The API keys the services need. Keys are sent to the main process and never shown again. */
export function ApiKeysSection({ loadKeys, saveKey, checkKey }: { loadKeys: LoadKeys; saveKey: SaveKey; checkKey: CheckKey }) {
  const [statuses, setStatuses] = useState<ApiKeyStatus[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    loadKeys()
      .then((s) => current && setStatuses(s))
      .catch((err: Error) => current && setLoadError(`Could not load the API keys: ${err.message}`));
    return () => {
      current = false;
    };
  }, [loadKeys]);

  const isSet = (name: ApiKeyName) => statuses?.some((s) => s.name === name && s.source !== null) ?? false;
  const noSpeechToText = statuses && !isSet('soniox') && !isSet('deepgram');

  return (
    <section className="settings__section" aria-labelledby="settings-keys">
      <h2 id="settings-keys">API keys</h2>
      <p className="settings__note settings__intro">
        Speech-to-text and translation are online services that need your own keys. Keys are stored
        encrypted on this computer and sent only to their service. A changed speech-to-text key
        applies from the next Session.
      </p>
      {loadError && (
        <p className="settings__status settings__status--error" role="alert">
          {loadError}
        </p>
      )}
      {noSpeechToText && (
        <p className="settings__warning" role="status">
          Without a Soniox or Deepgram key, Sessions record audio but no Transcript.
        </p>
      )}
      {statuses &&
        KEYS.map((k) => (
          <KeyField
            key={k.name}
            {...k}
            status={statuses.find((s) => s.name === k.name)}
            onChange={setStatuses}
            saveKey={saveKey}
            checkKey={checkKey}
          />
        ))}
    </section>
  );
}
