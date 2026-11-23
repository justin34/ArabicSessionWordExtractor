import { useEffect, useRef, useState } from 'react';
import { MAX_SESSION_NAME } from '../../core/types';
import './StartPanel.css';

/** Asks for an imported recording's Session name, filled with the file's name, all of it selected. */
export function ImportDialog({
  suggestedName,
  onImport,
  onCancel,
}: {
  suggestedName: string;
  onImport: (name: string | null) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(suggestedName);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.select();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        onSubmit={(e) => {
          e.preventDefault();
          onImport(name.trim() === '' ? null : name.trim());
        }}
      >
        <h2 id="import-title">Import a recording</h2>
        <p className="modal__hint">
          It is transcribed, translated and added to your Vocabulary like a recorded Session. You can leave
          this screen while it imports.
        </p>
        <label className="modal__field">
          <span>Name</span>
          <input
            ref={input}
            dir="auto"
            value={name}
            maxLength={MAX_SESSION_NAME}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <div className="modal__actions">
          <button type="submit" className="btn btn--primary">
            Import
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
