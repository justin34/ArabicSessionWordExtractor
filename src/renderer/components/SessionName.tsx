import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MAX_SESSION_NAME } from '../../core/types';
import './SessionName.css';

/**
 * A Session's name, renamed in place (GLOSSARY: Session names): click the name or its
 * pencil to edit; Enter or clicking away saves, Esc cancels, and clearing it goes back to
 * the date. Without `onRename` it is plain text.
 */
export function SessionName({
  name,
  date,
  onRename,
  titleClickable = true,
}: {
  name: string | null;
  /** What an unnamed Session is shown by. */
  date: string;
  /** Saves the new name (null to unname); absent when the Session cannot be renamed. */
  onRename?: (name: string | null) => void;
  /** Whether clicking the shown name edits it, as well as the pencil. */
  titleClickable?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);
  /** Set by Esc, so the blur that follows does not save. */
  const cancelled = useRef(false);
  const shown = name ?? date;

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  function edit(): void {
    cancelled.current = false;
    setDraft(name ?? '');
    setEditing(true);
  }

  function save(): void {
    if (cancelled.current) return;
    setEditing(false);
    const next = draft.trim() === '' ? null : draft.trim();
    if (next !== name) onRename?.(next);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelled.current = true;
      setEditing(false);
    }
  }

  if (!onRename) {
    return (
      <span className="session-name" dir="auto">
        {shown}
      </span>
    );
  }
  if (editing) {
    return (
      <input
        ref={input}
        className="session-name__input"
        dir="auto"
        aria-label="Session name"
        placeholder={date}
        maxLength={MAX_SESSION_NAME}
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={save}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }
  return (
    <span className="session-name">
      {titleClickable ? (
        <button
          type="button"
          className="session-name__text"
          dir="auto"
          title="Rename"
          onClick={(e) => {
            e.stopPropagation();
            edit();
          }}
        >
          {shown}
        </button>
      ) : (
        <span dir="auto">{shown}</span>
      )}
      <button
        type="button"
        className="session-name__pencil"
        aria-label={name ? `Rename ${name}` : 'Name this session'}
        title={name ? 'Rename' : 'Name this session'}
        onClick={(e) => {
          e.stopPropagation();
          edit();
        }}
      >
        ✎
      </button>
    </span>
  );
}
