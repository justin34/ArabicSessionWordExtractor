import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { AudioDevice, AudioSettings } from './types';

/** The system's own choices: all system audio (loopback) transcribed, the default microphone. */
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { desktopSource: null, microphone: null };

const MAX_TEXT = 500;

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

/**
 * The app's settings, kept in `settings.json` in its data folder. Only audio devices for
 * now; the rest of the settings screen (#13) is to be stored alongside.
 */
export class Settings {
  constructor(private readonly path: string) {}

  audio(): AudioSettings {
    return this.read().audio;
  }

  setAudio(settings: AudioSettings): AudioSettings {
    const file = this.read().file;
    writeFileSync(this.path, JSON.stringify({ ...file, audio: settings }, null, 2));
    return settings;
  }

  private read(): { file: Record<string, unknown>; audio: AudioSettings } {
    if (!existsSync(this.path)) return { file: {}, audio: DEFAULT_AUDIO_SETTINGS };
    try {
      const value: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
      const file = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
      const audio = file.audio === undefined ? DEFAULT_AUDIO_SETTINGS : parseAudioSettings(file.audio);
      if (!audio) console.warn(`${this.path} has malformed audio settings; the system defaults are used.`);
      return { file, audio: audio ?? DEFAULT_AUDIO_SETTINGS };
    } catch (err) {
      console.warn(`${this.path} could not be read (${(err as Error).message}); the system defaults are used.`);
      return { file: {}, audio: DEFAULT_AUDIO_SETTINGS };
    }
  }
}
