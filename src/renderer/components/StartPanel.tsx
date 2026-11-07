import { useEffect, useState } from 'react';
import type { AudioSettings } from '../bridge';
import './StartPanel.css';

export function StartPanel({
  devices,
  onStart,
  onCancel,
}: {
  /** The devices chosen in Settings; null while they load. */
  devices: AudioSettings | null;
  /** `mic` is whether the learner chose to also record the microphone as a Mic Track. */
  onStart: (options: { mic: boolean }) => void;
  onCancel: () => void;
}) {
  const [mic, setMic] = useState(false);
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
