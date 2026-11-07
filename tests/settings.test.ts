import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAudioSettings, Settings } from '../src/core/settings';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ill-settings-'));
  path = join(dir, 'settings.json');
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const stereoMix = { deviceId: 'abc', label: 'Stereo Mix (Realtek)' };
const headset = { deviceId: 'def', label: 'Headset Microphone' };

describe('Audio settings', () => {
  it('default to all system audio and the default microphone', () => {
    expect(new Settings(path).audio()).toEqual({ desktopSource: null, microphone: null });
  });

  it('are kept in settings.json across app runs, beside any other settings', () => {
    writeFileSync(path, JSON.stringify({ other: 1 }));
    new Settings(path).setAudio({ desktopSource: stereoMix, microphone: headset });

    expect(new Settings(path).audio()).toEqual({ desktopSource: stereoMix, microphone: headset });
    expect(JSON.parse(readFileSync(path, 'utf8')).other).toBe(1);
  });

  it('fall back to the system defaults when the file is unreadable or malformed', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    writeFileSync(path, '{not json');
    expect(new Settings(path).audio()).toEqual({ desktopSource: null, microphone: null });
    writeFileSync(path, JSON.stringify({ audio: { desktopSource: { deviceId: 5 } } }));
    expect(new Settings(path).audio()).toEqual({ desktopSource: null, microphone: null });
  });

  it('refuse malformed settings from the renderer', () => {
    expect(parseAudioSettings({ desktopSource: stereoMix, microphone: null })).toEqual({
      desktopSource: stereoMix,
      microphone: null,
    });
    expect(parseAudioSettings({})).toEqual({ desktopSource: null, microphone: null });
    expect(parseAudioSettings(null)).toBeUndefined();
    expect(parseAudioSettings({ desktopSource: { deviceId: '', label: 'x' } })).toBeUndefined();
    expect(parseAudioSettings({ microphone: { deviceId: 'a', label: 'x'.repeat(501) } })).toBeUndefined();
  });
});
