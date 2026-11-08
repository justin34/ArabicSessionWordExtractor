import { useCallback, useEffect, useState } from 'react';
import type { AudioCapture, AudioDevice, AudioSettings } from '../bridge';
import { formatThreshold } from '../micGate';
import { ApiKeysSection, type CheckKey, type LoadKeys, type SaveKey } from './ApiKeysSection';
import { ScreenHeader } from './ScreenHeader';
import './SettingsView.css';

const SYSTEM = '';

/** The options for one device choice: the system's own, each device, and a saved one now unplugged. */
function options(devices: AudioDevice[], saved: AudioDevice | null): Array<{ value: string; label: string }> {
  const listed = devices.map((d) => ({ value: d.deviceId, label: d.label }));
  if (saved && !devices.some((d) => d.deviceId === saved.deviceId)) {
    listed.push({ value: saved.deviceId, label: `${saved.label || 'Saved device'} (not connected)` });
  }
  return listed;
}

type DeviceKey = 'desktopSource' | 'microphone';

/** Opens a microphone only to meter it; nothing is recorded. */
export type OpenMicMeter = (device: AudioDevice | null) => Promise<AudioCapture>;

/** The selected microphone's live level, 0 to 1, while the screen is open. */
function useMicLevel(openMeter: OpenMicMeter, device: AudioDevice | null | undefined) {
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Reopened only when the chosen device changes, not when the settings object does.
  const deviceId = device === undefined ? undefined : (device?.deviceId ?? null);
  useEffect(() => {
    if (deviceId === undefined) return;
    let current = true;
    let capture: AudioCapture | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    setError(null);
    setLevel(0);
    openMeter(device ?? null)
      .then((opened) => {
        if (!current) return void opened.stop().catch(() => undefined);
        capture = opened;
        timer = setInterval(() => setLevel(opened.level()), 100);
      })
      .catch((err: Error) => current && setError(err.message));
    return () => {
      current = false;
      clearInterval(timer);
      void capture?.stop().catch(() => undefined);
    };
  }, [openMeter, deviceId]);
  return { level, error };
}

/** Percent, 0 to 100, for the slider and meter. */
const percent = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 100);

/**
 * The mic threshold slider over the selected microphone's live level, so the learner can
 * speak and see where their voice and any bleed land. 0 is off.
 */
function MicThreshold({
  threshold,
  level,
  meterError,
  onChange,
}: {
  threshold: number | undefined;
  level: number;
  meterError: string | null;
  onChange: (threshold: number | undefined) => void;
}) {
  const value = percent(threshold ?? 0);
  const passes = threshold === undefined || level >= threshold;
  return (
    <div className="settings__field">
      <label htmlFor="mic-threshold">Mic threshold</label>
      <div className="threshold">
        <div
          className="threshold__meter"
          role="meter"
          aria-label="Microphone level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent(level)}
        >
          <div
            className={`threshold__level${passes ? ' threshold__level--passes' : ''}`}
            style={{ width: `${percent(level)}%` }}
          />
          {threshold !== undefined && <div className="threshold__mark" style={{ left: `${value}%` }} />}
        </div>
        <input
          id="mic-threshold"
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          aria-valuetext={threshold === undefined ? 'Off' : formatThreshold(threshold)}
          aria-describedby="mic-threshold-note"
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange(n === 0 ? undefined : n / 100);
          }}
        />
        <output htmlFor="mic-threshold" className="threshold__value">
          {threshold === undefined ? 'Off' : formatThreshold(threshold)}
        </output>
      </div>
      <p id="mic-threshold-note" className="settings__note">
        When you transcribe your speech, mic audio quieter than this is not sent to speech-to-text,
        so the teacher heard through your speakers is less likely to be transcribed as you. Speak and
        set it above where the teacher’s voice lands. The Mic Track always records everything.
      </p>
      {meterError && (
        <p className="settings__status settings__status--error" role="alert">
          Could not open the microphone for the meter: {meterError}
        </p>
      )}
    </div>
  );
}

/**
 * Settings: which audio devices Sessions record from and the mic threshold, each choice
 * saved as soon as it is made, and the services' API keys.
 */
export function SettingsView({
  loadSettings,
  saveSettings,
  listDevices,
  openMeter,
  loadKeys,
  saveKey,
  checkKey,
}: {
  loadSettings: () => Promise<AudioSettings>;
  saveSettings: (settings: AudioSettings) => Promise<AudioSettings>;
  listDevices: () => Promise<AudioDevice[]>;
  openMeter: OpenMicMeter;
  loadKeys: LoadKeys;
  saveKey: SaveKey;
  checkKey: CheckKey;
}) {
  const [settings, setSettings] = useState<AudioSettings | null>(null);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [status, setStatus] = useState<{ kind: 'saved' | 'error'; text: string } | null>(null);
  const meter = useMicLevel(openMeter, settings?.microphone);

  const refreshDevices = useCallback(() => {
    listDevices()
      .then(setDevices)
      .catch((err: Error) => setStatus({ kind: 'error', text: `Could not list audio devices: ${err.message}` }));
  }, [listDevices]);

  useEffect(() => {
    let current = true;
    loadSettings()
      .then((s) => current && setSettings(s))
      .catch((err: Error) => {
        if (!current) return;
        setSettings({ desktopSource: null, microphone: null });
        setStatus({ kind: 'error', text: `Could not load the settings: ${err.message}` });
      });
    refreshDevices();
    return () => {
      current = false;
    };
  }, [loadSettings, refreshDevices]);

  function save(next: AudioSettings): void {
    setSettings(next);
    saveSettings(next)
      .then(() => setStatus({ kind: 'saved', text: 'Saved.' }))
      .catch((err: Error) => setStatus({ kind: 'error', text: `Could not save: ${err.message}` }));
  }

  function choose(key: DeviceKey, deviceId: string): void {
    if (!settings) return;
    const device =
      deviceId === SYSTEM
        ? null
        : (devices.find((d) => d.deviceId === deviceId) ?? (settings[key]?.deviceId === deviceId ? settings[key] : null));
    save({ ...settings, [key]: device });
  }

  function setThreshold(micThreshold: number | undefined): void {
    if (!settings) return;
    const { micThreshold: _previous, ...devices } = settings;
    save(micThreshold === undefined ? devices : { ...devices, micThreshold });
  }

  return (
    <>
      <ScreenHeader title="Settings" />
      <div className="settings">
        <section className="settings__section" aria-labelledby="settings-audio">
          <h2 id="settings-audio">Audio</h2>
          {settings && (
            <>
              <div className="settings__field">
                <label htmlFor="desktop-source">Desktop audio (transcribed)</label>
                <select
                  id="desktop-source"
                  value={settings.desktopSource?.deviceId ?? SYSTEM}
                  onChange={(e) => choose('desktopSource', e.target.value)}
                  aria-describedby="desktop-source-note"
                >
                  <option value={SYSTEM}>All system audio</option>
                  {options(devices, settings.desktopSource).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p id="desktop-source-note" className="settings__note">
                  All system audio records everything this computer plays. To transcribe a single app or
                  output, send it to an input such as Stereo Mix or a virtual audio cable and choose that here.
                </p>
              </div>
              <div className="settings__field">
                <label htmlFor="microphone">Microphone (Mic Track)</label>
                <select
                  id="microphone"
                  value={settings.microphone?.deviceId ?? SYSTEM}
                  onChange={(e) => choose('microphone', e.target.value)}
                  aria-describedby="microphone-note"
                >
                  <option value={SYSTEM}>System default</option>
                  {options(devices, settings.microphone).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p id="microphone-note" className="settings__note">
                  Used when a Session also records the microphone. It is transcribed only when you ask at the start.
                </p>
              </div>
              <MicThreshold
                threshold={settings.micThreshold}
                level={meter.level}
                meterError={meter.error}
                onChange={setThreshold}
              />
              <button type="button" className="btn" onClick={refreshDevices}>
                Refresh devices
              </button>
            </>
          )}
          {status && (
            <p
              className={`settings__status settings__status--${status.kind}`}
              role={status.kind === 'error' ? 'alert' : 'status'}
            >
              {status.text}
            </p>
          )}
        </section>
        <ApiKeysSection loadKeys={loadKeys} saveKey={saveKey} checkKey={checkKey} />
      </div>
    </>
  );
}
