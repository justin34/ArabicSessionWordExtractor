import { useEffect, useState } from 'react';
import type { ApiKeyName, ApiKeyStatus, AudioSettings } from '../bridge';
import './StartPanel.css';

/** What a Session will be without, given which keys are set; nothing while they load. */
function missingKeyWarnings(keys: ApiKeyStatus[] | null): string[] {
  if (!keys) return [];
  const has = (name: ApiKeyName) => keys.some((k) => k.name === name && k.source !== null);
  const warnings: string[] = [];
  if (!has('soniox') && !has('deepgram')) {
    warnings.push('No speech-to-text key: the audio will be recorded, but without a Transcript.');
  }
  if (!has('googleTranslate')) warnings.push('No translation key: sentences will not be translated.');
  return warnings;
}

export function StartPanel({
  devices,
  keys = null,
  onOpenSettings,
  onStart,
  onCancel,
}: {
  /** The devices chosen in Settings; null while they load. */
  devices: AudioSettings | null;
  /** Which API keys are set; null while they load. */
  keys?: ApiKeyStatus[] | null;
  onOpenSettings?: () => void;
  /** `mic` is whether the learner chose to also record the microphone as a Mic Track. */
  onStart: (options: { mic: boolean }) => void;
  onCancel: () => void;
}) {
  const [mic, setMic] = useState(false);
  const warnings = missingKeyWarnings(keys);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="start-panel-title">
        <h2 id="start-panel-title">Start a Session</h2>
        <p className="modal__hint">
          Desktop audio (a class or video playing on this computer) will be recorded and transcribed.
        </p>
        {devices && (
          <p className="modal__devices">
            Transcribing: <strong>{devices.desktopSource?.label ?? 'All system audio'}</strong>. Change
            devices in Settings.
          </p>
        )}
        {warnings.length > 0 && (
          <div className="modal__warning" role="status">
            {warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
            {onOpenSettings && (
              <button type="button" className="btn btn--link" onClick={onOpenSettings}>
                Add keys in Settings
              </button>
            )}
          </div>
        )}
        <div className="modal__option">
          <input
            id="mic-option"
            type="checkbox"
            checked={mic}
            onChange={(e) => setMic(e.target.checked)}
            aria-describedby="mic-note"
          />
          <label htmlFor="mic-option">Also record my microphone</label>
          <span id="mic-note" className="modal__note">
            {devices && <>From {devices.microphone?.label ?? 'the default microphone'}. </>}
            Saved as a separate track that plays alongside in Replay. It is never transcribed.
          </span>
        </div>
        <div className="modal__actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={() => onStart({ mic })} autoFocus>
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
