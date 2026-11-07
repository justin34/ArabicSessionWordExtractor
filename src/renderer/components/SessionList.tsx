import type { ListedSession } from '../bridge';
import { formatStart, sessionDuration } from '../format';
import { Badge } from './Badge';
import { EmptyState } from './EmptyState';
import { ScreenHeader } from './ScreenHeader';
import { sessionKey } from '../sessionKey';
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
      <ScreenHeader title="Sessions">
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
      </ScreenHeader>
      {sessions.length === 0 ? (
        <EmptyState title="No sessions yet">
          Start a Session to listen to a class or video and see the transcript live.
        </EmptyState>
      ) : (
        <ul className="session-list" aria-label="Session list">
          {sessions.map((s) => (
            <li key={sessionKey(s)}>
              <button
                type="button"
                className="session-row"
                aria-label={`Open session from ${formatStart(s.startedAt)}`}
                onClick={() => onOpen(s)}
              >
                <span className="session-row__start">{formatStart(s.startedAt)}</span>
                <span className="session-row__duration">{sessionDuration(s, now)}</span>
                {s.isDemo && <Badge kind="demo">Demo</Badge>}
                <Badge kind={s.status}>{s.status === 'recording' ? 'Recording' : 'Completed'}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
