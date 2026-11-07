import type { ListedSession, SessionGuide, Utterance } from '../bridge';
import { formatStart, sessionDuration } from '../format';
import { ReplayView } from './ReplayView';
import { SessionGuideView } from './SessionGuideView';
import type { LoadWordDetails } from './WordPanel';
import './SessionView.css';

export type SessionTab = 'replay' | 'guide';

const TABS: Array<{ id: SessionTab; label: string }> = [
  { id: 'replay', label: 'Replay' },
  { id: 'guide', label: 'Session Guide' },
];

/**
 * A completed Session: its Replay View and its Session Guide, one tab each. Replay stays
 * mounted behind the guide, so playback carries on while the learner reads it.
 */
export function SessionView({
  session,
  tab,
  onTabChange,
  audioUrl,
  loadTranscript,
  loadWordDetails,
  loadGuide,
  onOpenWord,
  onBack,
}: {
  session: ListedSession;
  tab: SessionTab;
  onTabChange: (tab: SessionTab) => void;
  audioUrl: string;
  loadTranscript: (sessionId: number) => Promise<Utterance[]>;
  loadWordDetails: LoadWordDetails;
  loadGuide: (sessionId: number) => Promise<SessionGuide | null>;
  onOpenWord: (lemmaId: number) => void;
  onBack: () => void;
}) {
  const lengthMs = session.endedAt
    ? new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()
    : 0;
  return (
    <div className="session-view">
      <button type="button" className="btn btn--link session-view__back" onClick={onBack}>
        ← Back to Sessions
      </button>
      <header className="session-view__header">
        <h1>{formatStart(session.startedAt)}</h1>
        <span className="session-view__length">{sessionDuration(session, Date.now())}</span>
      </header>
      <div className="session-view__tabs" role="tablist" aria-label="Session">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`session-tab-${t.id}`}
            aria-controls={`session-panel-${t.id}`}
            aria-selected={tab === t.id}
            className="session-view__tab"
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="session-panel-replay"
        aria-labelledby="session-tab-replay"
        className="session-view__panel session-view__panel--replay"
        hidden={tab !== 'replay'}
      >
        <ReplayView
          sessionId={session.id}
          audioUrl={audioUrl}
          fallbackDurationMs={lengthMs}
          loadTranscript={loadTranscript}
          loadWordDetails={loadWordDetails}
        />
      </div>
      {tab === 'guide' && (
        <div
          role="tabpanel"
          id="session-panel-guide"
          aria-labelledby="session-tab-guide"
          className="session-view__panel"
        >
          <SessionGuideView sessionId={session.id} loadGuide={loadGuide} onOpenWord={onOpenWord} />
        </div>
      )}
    </div>
  );
}
