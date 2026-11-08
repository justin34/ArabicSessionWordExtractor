import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { ApiKeyName, AudioDevice, AudioSettings, ReplayLayout } from './types';

/** The system's own choices: all system audio (loopback) transcribed, the default microphone. */
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { desktopSource: null, microphone: null };

/** Learner Utterances are interleaved with the teacher's until the learner chooses otherwise. */
export const DEFAULT_REPLAY_LAYOUT: ReplayLayout = 'together';

export function isReplayLayout(value: unknown): value is ReplayLayout {
  return value === 'together' || value === 'separate';
}

/** The API keys the settings screen holds, in the order it shows them. */
export const API_KEY_NAMES: readonly ApiKeyName[] = ['soniox', 'deepgram', 'googleTranslate'];

const MAX_TEXT = 500;
const MAX_KEY = 2000;

/**
 * How API keys are kept on disk. The main process encrypts them with the operating
 * system's key store (Electron safeStorage); tests keep them as they are.
 */
export interface SecretCodec {
  encode(plain: string): string;
  /** Throws when the stored value cannot be decoded, e.g. it was encrypted for another user. */
  decode(stored: string): string;
}

const PLAIN: SecretCodec = { encode: (s) => s, decode: (s) => s };

function asDevice(value: unknown): AudioDevice | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'object' || value === undefined) return undefined;
  const { deviceId, label } = value as Record<string, unknown>;
  if (typeof deviceId !== 'string' || deviceId === '' || deviceId.length > MAX_TEXT) return undefined;
  if (typeof label !== 'string' || label.length > MAX_TEXT) return undefined;
  return { deviceId, label };
}

/** Audio settings as given (from the settings file or the renderer); undefined when malformed. */
export function parseAudioSettings(value: unknown): AudioSettings | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { desktopSource, microphone } = value as Record<string, unknown>;
  const desktop = asDevice(desktopSource ?? null);
  const mic = asDevice(microphone ?? null);
  if (desktop === undefined || mic === undefined) return undefined;
  return { desktopSource: desktop, microphone: mic };
}

export function isApiKeyName(value: unknown): value is ApiKeyName {
  return typeof value === 'string' && (API_KEY_NAMES as readonly string[]).includes(value);
}

/**
 * A key as entered: surrounding whitespace (a stray space or newline from copying) is
 * dropped; empty means remove. Undefined when it cannot be a key.
 */
export function parseApiKey(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const key = value.trim();
  if (key === '') return null;
  if (key.length > MAX_KEY || /\s/.test(key)) return undefined;
  return key;
}

type SettingsFile = Record<string, unknown>;

/** The app's settings, kept in `settings.json` in its data folder: audio devices and API keys. */
export class Settings {
  constructor(
    private readonly path: string,
    private readonly secrets: SecretCodec = PLAIN,
  ) {}

  audio(): AudioSettings {
    const file = this.read();
    if (file.audio === undefined) return DEFAULT_AUDIO_SETTINGS;
    const audio = parseAudioSettings(file.audio);
    if (!audio) console.warn(`${this.path} has malformed audio settings; the system defaults are used.`);
    return audio ?? DEFAULT_AUDIO_SETTINGS;
  }

  setAudio(settings: AudioSettings): AudioSettings {
    this.write({ ...this.read(), audio: settings });
    return settings;
  }

  /** How Replay shows Learner Utterances, for every Session; Together until chosen. */
  replayLayout(): ReplayLayout {
    const stored = this.read().replayLayout;
    return isReplayLayout(stored) ? stored : DEFAULT_REPLAY_LAYOUT;
  }

  setReplayLayout(layout: ReplayLayout): ReplayLayout {
    this.write({ ...this.read(), replayLayout: layout });
    return layout;
  }

  /** A stored API key; undefined when none is stored or it cannot be read back. */
  apiKey(name: ApiKeyName): string | undefined {
    const stored = this.storedKeys()[name];
    if (typeof stored !== 'string' || stored === '') return undefined;
    try {
      return this.secrets.decode(stored);
    } catch (err) {
      console.warn(`The stored ${name} key could not be read (${(err as Error).message}); enter it again.`);
      return undefined;
    }
  }

  /** Stores an API key, or removes it with null. */
  setApiKey(name: ApiKeyName, key: string | null): void {
    const file = this.read();
    const keys = { ...this.storedKeys(file) };
    if (key === null) delete keys[name];
    else keys[name] = this.secrets.encode(key);
    this.write({ ...file, apiKeys: keys });
  }

  private storedKeys(file = this.read()): Record<string, unknown> {
    const keys = file.apiKeys;
    return typeof keys === 'object' && keys !== null && !Array.isArray(keys) ? (keys as Record<string, unknown>) : {};
  }

  private write(file: SettingsFile): void {
    writeFileSync(this.path, JSON.stringify(file, null, 2));
  }

  private read(): SettingsFile {
    if (!existsSync(this.path)) return {};
    try {
      const value: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
      return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as SettingsFile) : {};
    } catch (err) {
      console.warn(`${this.path} could not be read (${(err as Error).message}); the defaults are used.`);
      return {};
    }
  }
}
