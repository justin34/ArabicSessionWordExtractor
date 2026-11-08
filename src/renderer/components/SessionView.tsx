import { useCallback } from 'react';
import type { ListedSession, MicTranscriptionStatus, ReplayLayout, SessionGuide, Utterance } from '../bridge';
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
  transcriptVersion = 0,
  micTranscription,
  onTranscribeMic,
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
  /** Changes when the stored Transcript has, so it is loaded again. */
  transcriptVersion?: number;
  /** How "Transcribe my microphone" is going for this Session, if it was asked for. */
  micTranscription?: MicTranscriptionStatus;
  /** Transcribes the Mic Track afterwards; offered while the Session has one and no Learner Utterances. */
  onTranscribeMic?: () => void;
  loadWordDetails: LoadWordDetails;
  loadGuide: (sessionId: number) => Promise<SessionGuide | null>;
  onOpenWord: (lemmaId: number) => void;
  onBack: () => void;
  anki: AnkiActions;
}) {
  // A new transcriptVersion means the stored Transcript changed: load it again.
  const load = useCallback(() => loadTranscript(session.id), [loadTranscript, session.id, transcriptVersion]);
  const transcript = useLoaded(load);
  const hasLearner = transcript.state === 'loaded' && transcript.value.some((u) => u.track === 'mic');
  const separate = hasLearner && layout === 'separate';
  // Runs once: not after it has worked this run, nor while it runs.
  const offerMicTranscription =
    onTranscribeMic !== undefined &&
    session.micTrackPath !== null &&
    transcript.state === 'loaded' &&
    !hasLearner &&
    micTranscription?.state !== 'running' &&
    micTranscription?.state !== 'done';
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
        {offerMicTranscription && (
          <button type="button" className="btn session-view__transcribe-mic" onClick={onTranscribeMic}>
            Transcribe my microphone
          </button>
        )}
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
      {micTranscription?.state === 'running' && (
        <p className="session-view__mic-note" role="status">
          {micTranscription.note}
        </p>
      )}
      {micTranscription?.state === 'failed' && (
        <p className="session-view__mic-note session-view__mic-note--failed" role="alert">
          Could not transcribe your speech: {micTranscription.message}
        </p>
      )}
      {micTranscription?.state === 'done' && !hasLearner && transcript.state === 'loaded' && (
        <p className="session-view__mic-note" role="status">
          No speech was found on your microphone.
        </p>
      )}
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
