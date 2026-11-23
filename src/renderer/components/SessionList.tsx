import type { ImportStatus, ListedSession } from '../bridge';
import { formatStart, sessionDuration } from '../format';
import { Badge } from './Badge';
import { EmptyState } from './EmptyState';
import { ScreenHeader } from './ScreenHeader';
import { SessionName } from './SessionName';
import { TrashIcon } from './TrashIcon';
import { sessionKey } from '../sessionKey';
import './SessionList.css';

/** What the Session List lets the learner do to completed Sessions and imports. */
export interface SessionActions {
  /** Names a completed Session; null unnames it. */
  onRename: (s: ListedSession, name: string | null) => void;
  /** Opens the remove dialog for a completed Session. */
  onRemove: (s: ListedSession) => void;
  /** Whether a Session can be removed now (not while its mic transcription runs). */
  canRemove: (s: ListedSession) => boolean;
  /** Abandons an import. */
  onCancelImport: (s: ListedSession) => void;
}

/** "Import recording" in the header: disabled without a speech-to-text key, or while one imports. */
export interface ImportOffer {
  onImport: () => void;
  /** Why it is disabled; undefined when it is not. */
  disabledBecause?: 'no-key' | 'importing';
  onOpenSettings: () => void;
}

export function SessionList({
  sessions,
  now,
  onOpen,
  onStart,
  startDisabled,
  onStartDemo,
  actions,
  importOffer,
  imports = {},
}: {
  sessions: ListedSession[];
  now: number;
  onOpen: (s: ListedSession) => void;
  onStart: () => void;
  startDisabled: boolean;
  /** Present only when Demo Sessions are available (dev builds). */
  onStartDemo?: () => void;
  actions?: SessionActions;
  importOffer?: ImportOffer;
  /** How each import running is going, by Session id. */
  imports?: Record<number, ImportStatus>;
}) {
  return (
    <>
      <ScreenHeader title="Sessions">
        {onStartDemo && (
          <button type="button" className="btn" onClick={onStartDemo}>
            Start Demo Session
          </button>
        )}
        {importOffer && (
          <button
            type="button"
            className="btn"
            onClick={importOffer.onImport}
            disabled={importOffer.disabledBecause !== undefined}
            aria-describedby={importOffer.disabledBecause === 'no-key' ? 'import-hint' : undefined}
          >
            Import recording
          </button>
        )}
        <button
          type="button"
          className="btn btn--primary"
          onClick={onStart}
          disabled={startDisabled}
        >
          Start Session
        </button>
      </ScreenHeader>
      {importOffer?.disabledBecause === 'no-key' && (
        <p id="import-hint" className="session-list__hint">
          Importing a recording needs a speech-to-text key.{' '}
          <button type="button" className="btn btn--link" onClick={importOffer.onOpenSettings}>
            Add one in Settings
          </button>
        </p>
      )}
      {sessions.length === 0 ? (
        <EmptyState title="No sessions yet">
          Start a Session to listen to a class or video and see the transcript live, or import a recording.
        </EmptyState>
      ) : (
        <ul className="session-list" aria-label="Session list">
          {sessions.map((s) => (
            <SessionRow key={sessionKey(s)} session={s} now={now} onOpen={onOpen} actions={actions} status={imports[s.id]} />
          ))}
        </ul>
      )}
    </>
  );
}

function SessionRow({
  session: s,
  now,
  onOpen,
  actions,
  status,
}: {
  session: ListedSession;
  now: number;
  onOpen: (s: ListedSession) => void;
  actions?: SessionActions;
  status?: ImportStatus;
}) {
  const date = formatStart(s.startedAt);
  const importing = s.status === 'importing';
  const completed = s.status === 'completed' && !s.isDemo;
  const rename = completed && actions ? (name: string | null) => actions.onRename(s, name) : undefined;
  const label = s.name ?? date;
  return (
    <li
      className={`session-row${importing ? ' session-row--importing' : ''}`}
      // The rest of the row opens it too; its own buttons and the name field do not.
      onClick={(e) => {
        if (!importing && !(e.target as Element).closest('button, input')) onOpen(s);
      }}
    >
      <div className="session-row__titles">
        <span className="session-row__name">
          {/* An unnamed row is opened by its date; only the pencil names it. */}
          <SessionName name={s.name} date={date} onRename={rename} titleClickable={s.name !== null} />
        </span>
        {s.name !== null && <span className="session-row__date">{date}</span>}
        {importing && status?.state === 'running' && (
          <span className="session-row__note" role="status">
            {status.note}
          </span>
        )}
      </div>
      {importing ? (
        <>
          <Badge kind="importing">Importing</Badge>
          {actions && (
            <button
              type="button"
              className="btn"
              aria-label={`Cancel importing ${label}`}
              onClick={() => actions.onCancelImport(s)}
            >
              Cancel
            </button>
          )}
        </>
      ) : (
        <button
          type="button"
          className="session-row__open"
          aria-label={`Open session from ${date}`}
          onClick={() => onOpen(s)}
        >
          <span className="session-row__duration">{sessionDuration(s, now)}</span>
          {s.isDemo && <Badge kind="demo">Demo</Badge>}
          {s.imported && <Badge kind="imported">Imported</Badge>}
          <Badge kind={s.status === 'recording' ? 'recording' : 'completed'}>
            {s.status === 'recording' ? 'Recording' : 'Completed'}
          </Badge>
        </button>
      )}
      {completed && actions?.canRemove(s) && (
        <button
          type="button"
          className="session-row__remove"
          aria-label="Remove session"
          title="Remove session"
          onClick={() => actions.onRemove(s)}
        >
          <TrashIcon />
        </button>
      )}
    </li>
  );
}
