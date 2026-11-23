import { useCallback, useEffect, useState } from 'react';
import type { ListedSession, RemovalPreview } from '../bridge';
import { formatShortStart } from '../format';
import { useLoaded } from '../useLoaded';
import { Badge } from './Badge';
import './StartPanel.css';
import './RemoveDialog.css';

const wordCount = (n: number) => `${n} ${n === 1 ? 'word' : 'words'}`;

/**
 * Confirms removing a Session (ADR 0005), with no undo; Cancel has the focus. Unless "Keep
 * its words" is ticked, it lists the words heard only in this Session, which will leave
 * the Vocabulary.
 */
export function RemoveDialog({
  session,
  loadPreview,
  onRemove,
  onCancel,
}: {
  session: ListedSession;
  loadPreview: (sessionId: number) => Promise<RemovalPreview>;
  onRemove: (keepWords: boolean) => void;
  onCancel: () => void;
}) {
  const [keepWords, setKeepWords] = useState(false);
  const load = useCallback(() => loadPreview(session.id), [loadPreview, session.id]);
  const preview = useLoaded(load);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const date = formatShortStart(session.startedAt);
  const title = session.name ? (
    <>
      Remove “<span dir="auto">{session.name}</span>” ({date})?
    </>
  ) : (
    <>Remove the Session of {date}?</>
  );
  const words = preview.state === 'loaded' ? preview.value.words : [];
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="remove-title" aria-describedby="remove-what">
        <h2 id="remove-title">{title}</h2>
        <p id="remove-what">Its recording and transcript will be deleted.</p>
        {preview.state === 'loading' && <p className="modal__hint">Checking its words…</p>}
        {preview.state === 'failed' && (
          <p className="modal__warning" role="alert">
            Could not check its words: {preview.message}
          </p>
        )}
        {words.length > 0 && (
          <>
            <div className="modal__option">
              <input
                id="keep-words-option"
                type="checkbox"
                checked={keepWords}
                onChange={(e) => setKeepWords(e.target.checked)}
              />
              <label htmlFor="keep-words-option">Keep its words in my Vocabulary</label>
            </div>
            {!keepWords && (
              <>
                <p id="leaving-words">
                  <strong>{wordCount(words.length)} heard only in this Session will leave your Vocabulary:</strong>
                </p>
                <ul className="remove-dialog__words" aria-labelledby="leaving-words">
                  {words.map((w) => (
                    <li key={w.lemmaId} className="remove-dialog__word">
                      <span lang="ar" dir="rtl" className="remove-dialog__lemma">
                        {w.lemma}
                      </span>
                      <span className="remove-dialog__gloss">{w.gloss}</span>
                      {w.ignored && <Badge kind="ignored">Ignored</Badge>}
                    </li>
                  ))}
                </ul>
                <p className="modal__note">Words already imported into Anki stay there.</p>
              </>
            )}
          </>
        )}
        <div className="modal__actions">
          <button
            type="button"
            className="btn btn--danger"
            disabled={preview.state !== 'loaded'}
            onClick={() => onRemove(words.length > 0 && keepWords)}
          >
            Remove
          </button>
          <button type="button" className="btn" onClick={onCancel} autoFocus>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
