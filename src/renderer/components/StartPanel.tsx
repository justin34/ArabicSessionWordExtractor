import { useEffect } from 'react';
import './StartPanel.css';

export function StartPanel({ onStart, onCancel }: { onStart: () => void; onCancel: () => void }) {
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
        <div className="modal__option">
          <input id="mic-option" type="checkbox" disabled aria-describedby="mic-soon" />
          <label htmlFor="mic-option">Also record my microphone</label>
          <span id="mic-soon" className="modal__soon">
            Microphone recording is coming soon.
          </span>
        </div>
        <div className="modal__actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={onStart} autoFocus>
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
