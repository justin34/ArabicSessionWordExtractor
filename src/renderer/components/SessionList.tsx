import type { ListedSession } from '../bridge';
import { formatStart, sessionDuration } from '../format';
import { EmptyState } from './EmptyState';
import './SessionList.css';

export function SessionList({
  sessions,
  now,
  onOpen,
  onStart,
  startDisabled,
  onStartDemo,
}: {
  sessions: ListedSession[];
  now: number;
  onOpen: (s: ListedSession) => void;
  onStart: () => void;
  startDisabled: boolean;
  /** Present only when Demo Sessions are available (dev builds). */
  onStartDemo?: () => void;
}) {
  return (
    <>
      <div className="screen__header">
        <h1>Sessions</h1>
        <div className="screen__actions">
          {onStartDemo && (
            <button type="button" className="btn" onClick={onStartDemo}>
              Start Demo Session
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
        </div>
      </div>
      {sessions.length === 0 ? (
        <EmptyState title="No sessions yet">
          Start a Session to listen to a class or video and see the transcript live.
        </EmptyState>
      ) : (
        <ul className="session-list" aria-label="Session list">
          {sessions.map((s) => (
            <li key={s.isDemo ? `demo-${s.id}` : s.id}>
              <button
                type="button"
                className="session-row"
                aria-label={`Open session from ${formatStart(s.startedAt)}`}
                onClick={() => onOpen(s)}
              >
                <span className="session-row__start">{formatStart(s.startedAt)}</span>
                <span className="session-row__duration">{sessionDuration(s, now)}</span>
                {s.isDemo && <span className="badge badge--demo">Demo</span>}
                <span className={`badge badge--${s.status}`}>
                  {s.status === 'recording' ? 'Recording' : 'Completed'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
