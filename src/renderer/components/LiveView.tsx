import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ListedSession, LiveUtterance } from '../bridge';
import { sessionDuration } from '../format';
import { EmptyState } from './EmptyState';
import { UtteranceView } from './UtteranceView';
import './LiveView.css';

function LevelMeter({ getLevel }: { getLevel: () => number }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setLevel(getLevel()), 100);
    return () => clearInterval(id);
  }, [getLevel]);
  const pct = Math.round(Math.min(1, Math.max(0, level)) * 100);
  return (
    <div
      className="level"
      role="meter"
      aria-label="Audio level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div className="level__bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

const BOTTOM_TOLERANCE_PX = 24;

export function LiveView({
  session,
  now,
  utterances,
  getLevel,
  onStop,
  onBack,
}: {
  session: ListedSession;
  now: number;
  utterances: LiveUtterance[];
  /** Audio level source; absent for Demo Sessions, which capture no audio. */
  getLevel?: () => number;
  onStop: () => void;
  onBack: () => void;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  // Following the live edge; pauses when the learner scrolls up.
  const [following, setFollowing] = useState(true);

  useLayoutEffect(() => {
    const el = logRef.current;
    if (following && el) el.scrollTop = el.scrollHeight;
  }, [utterances, following]);

  function onScroll() {
    const el = logRef.current;
    if (!el) return;
    setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_TOLERANCE_PX);
  }

  return (
    <div className="live">
      <button type="button" className="btn btn--link" onClick={onBack}>
        ← Back to Sessions
      </button>
      <header className="live__header">
        <h1>Live View</h1>
        {session.isDemo && <span className="badge badge--demo">Demo</span>}
        <span className="live__timer">{sessionDuration(session, now)}</span>
        {getLevel && <LevelMeter getLevel={getLevel} />}
        <button type="button" className="btn btn--danger" onClick={onStop}>
          Stop
        </button>
      </header>
      <div className="live__bodywrap">
        <div className="live__body" role="log" aria-label="Transcript" ref={logRef} onScroll={onScroll}>
          {utterances.length === 0 && (
            <EmptyState title="Listening…">
              {session.isDemo
                ? 'The demo transcript will start in a moment.'
                : 'The transcript appears here once speech-to-text is connected.'}
            </EmptyState>
          )}
          {utterances.map((u) => (
            <UtteranceView key={u.id} utterance={u} />
          ))}
        </div>
        {!following && (
          <button type="button" className="btn btn--primary live__jump" onClick={() => setFollowing(true)}>
            Jump to latest
          </button>
        )}
      </div>
    </div>
  );
}
