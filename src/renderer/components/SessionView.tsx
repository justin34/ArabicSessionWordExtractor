import { useCallback } from 'react';
import type { ListedSession, ReplayLayout, SessionGuide, Utterance } from '../bridge';
import { formatStart, sessionDuration } from '../format';
import { useLoaded } from '../useLoaded';
import { ReplayView, type ReplayShows } from './ReplayView';
import type { AnkiActions } from './AnkiExport';
import { SessionGuideView } from './SessionGuideView';
import type { LoadWordDetails } from './WordPanel';
import './SessionView.css';

export type SessionTab = 'replay' | 'my-speech' | 'guide';

const LAYOUTS: Array<{ id: ReplayLayout; label: string }> = [
  { id: 'together', label: 'Together' },
  { id: 'separate', label: 'Separate' },
];

/**
 * A completed Session: its Replay View and its Session Guide, one tab each, plus a My
 * Speech tab when Learner Utterances are shown Separate. One player serves the Replay
 * and My Speech tabs and stays mounted behind the guide, so playback carries on whichever
 * tab the learner reads.
 */
export function SessionView({
  session,
  tab,
  onTabChange,
  layout,
  onLayoutChange,
  audioUrl,
  micAudioUrl,
  loadTranscript,
  loadWordDetails,
  loadGuide,
  onOpenWord,
  onBack,
  anki,
}: {
  session: ListedSession;
  tab: SessionTab;
  onTabChange: (tab: SessionTab) => void;
  /** Together or Separate; only offered when the Session has Learner Utterances. */
  layout: ReplayLayout;
  onLayoutChange: (layout: ReplayLayout) => void;
  audioUrl: string;
  /** The Mic Track, when the Session has one; played in sync with the Desktop Track. */
  micAudioUrl?: string;
  loadTranscript: (sessionId: number) => Promise<Utterance[]>;
  loadWordDetails: LoadWordDetails;
  loadGuide: (sessionId: number) => Promise<SessionGuide | null>;
  onOpenWord: (lemmaId: number) => void;
  onBack: () => void;
  anki: AnkiActions;
}) {
  const load = useCallback(() => loadTranscript(session.id), [loadTranscript, session.id]);
  const transcript = useLoaded(load);
  const hasLearner = transcript.state === 'loaded' && transcript.value.some((u) => u.track === 'mic');
  const separate = hasLearner && layout === 'separate';
  // My Speech exists only while Separate; switching to Together shows it all on Replay.
  const shownTab: SessionTab = tab === 'my-speech' && !separate ? 'replay' : tab;
  const tabs: Array<{ id: SessionTab; label: string }> = [
    { id: 'replay', label: 'Replay' },
    ...(separate ? [{ id: 'my-speech' as const, label: 'My Speech' }] : []),
    { id: 'guide', label: 'Session Guide' },
  ];
  const shows: ReplayShows = !hasLearner || separate ? (shownTab === 'my-speech' ? 'learner' : 'teacher') : 'all';
  const playerTab = shownTab === 'my-speech' ? 'my-speech' : 'replay';

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
        {hasLearner && (
          <div className="session-view__layout" role="radiogroup" aria-label="Show my speech">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={layout === l.id}
                className="session-view__layout-option"
                onClick={() => layout !== l.id && onLayoutChange(l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="session-view__tabs" role="tablist" aria-label="Session">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`session-tab-${t.id}`}
            aria-controls={t.id === 'guide' ? 'session-panel-guide' : 'session-panel-replay'}
            aria-selected={shownTab === t.id}
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
        aria-labelledby={`session-tab-${playerTab}`}
        className="session-view__panel session-view__panel--replay"
        hidden={shownTab === 'guide'}
      >
        <ReplayView
          transcript={transcript}
          shows={shows}
          audioUrl={audioUrl}
          micAudioUrl={micAudioUrl}
          fallbackDurationMs={lengthMs}
          loadWordDetails={loadWordDetails}
        />
      </div>
      {shownTab === 'guide' && (
        <div
          role="tabpanel"
          id="session-panel-guide"
          aria-labelledby="session-tab-guide"
          className="session-view__panel"
        >
          <SessionGuideView sessionId={session.id} loadGuide={loadGuide} onOpenWord={onOpenWord} anki={anki} />
        </div>
      )}
    </div>
  );
}
