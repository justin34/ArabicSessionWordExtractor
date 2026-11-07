import { useCallback, useEffect, useState } from 'react';
import type { AudioDevice, AudioSettings } from '../bridge';
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

/**
 * Settings: which audio devices Sessions record from. Each choice is saved as soon as it
 * is made. API keys are to join it with #13.
 */
export function SettingsView({
  loadSettings,
  saveSettings,
  listDevices,
}: {
  loadSettings: () => Promise<AudioSettings>;
  saveSettings: (settings: AudioSettings) => Promise<AudioSettings>;
  listDevices: () => Promise<AudioDevice[]>;
}) {
  const [settings, setSettings] = useState<AudioSettings | null>(null);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [status, setStatus] = useState<{ kind: 'saved' | 'error'; text: string } | null>(null);

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

  function choose(key: keyof AudioSettings, deviceId: string): void {
    if (!settings) return;
    const device =
      deviceId === SYSTEM
        ? null
        : (devices.find((d) => d.deviceId === deviceId) ?? (settings[key]?.deviceId === deviceId ? settings[key] : null));
    const next = { ...settings, [key]: device };
    setSettings(next);
    saveSettings(next)
      .then(() => setStatus({ kind: 'saved', text: 'Saved.' }))
      .catch((err: Error) => setStatus({ kind: 'error', text: `Could not save: ${err.message}` }));
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
                  Used when a Session also records the microphone. It is never transcribed.
                </p>
              </div>
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
        <section className="settings__section" aria-labelledby="settings-keys">
          <h2 id="settings-keys">API keys</h2>
          <p className="settings__note">API keys and other preferences are coming soon.</p>
        </section>
      </div>
    </>
  );
}
