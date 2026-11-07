import { useCallback } from 'react';
import type { ListedSession, SessionGuide } from '../bridge';
import { formatStart, sessionDuration } from '../format';
import { useLoaded } from '../useLoaded';
import { EmptyState } from './EmptyState';
import { ScreenHeader } from './ScreenHeader';
import './StudyGuides.css';

const times = (n: number) => (n === 1 ? 'once' : `${n} times`);

function summary(guide: SessionGuide): string {
  const fresh = guide.groups.reduce((n, g) => n + g.words.length, 0);
  const heard = `${guide.lemmasHeard} ${guide.lemmasHeard === 1 ? 'word' : 'words'} heard`;
  return `${fresh} new ${fresh === 1 ? 'word' : 'words'} · ${heard}`;
}

/**
 * A completed Session: its Session Guide, listing the words first heard in it, grouped,
 * each opening its Word Card. Replay View (#11) will join it here.
 */
export function SessionGuideView({
  session,
  loadGuide,
  onOpenWord,
  onBack,
}: {
  session: ListedSession;
  loadGuide: (sessionId: number) => Promise<SessionGuide | null>;
  onOpenWord: (lemmaId: number) => void;
  onBack: () => void;
}) {
  const load = useCallback(() => loadGuide(session.id), [loadGuide, session.id]);
  const guide = useLoaded(load);

  let body;
  if (guide.state === 'loading') body = null;
  else if (guide.state === 'failed')
    body = <EmptyState title="Could not load the Session Guide">{guide.message}</EmptyState>;
  else if (!guide.value)
    body = <EmptyState title="No Session Guide yet">It is generated when the Session ends.</EmptyState>;
  else if (guide.value.groups.length === 0)
    body = (
      <EmptyState title="No new words">
        {guide.value.lemmasHeard > 0
          ? 'Every word in this Session was already in your Vocabulary.'
          : 'No words were heard in this Session.'}
      </EmptyState>
    );
  else
    body = (
      <>
        <p className="guide__summary">{summary(guide.value)}</p>
        {guide.value.groups.map((group) => (
          <section key={group.title} className="guide__group" aria-label={group.title}>
            <h2 className="guide__group-title">{group.title}</h2>
            <ul className="guide__words">
              {group.words.map((w) => (
                <li key={w.lemmaId}>
                  <button
                    type="button"
                    className="guide__word"
                    aria-label={`Word Card for ${w.lemma}`}
                    onClick={() => onOpenWord(w.lemmaId)}
                  >
                    <span className="guide__lemma" lang="ar" dir="rtl">
                      {w.lemma}
                    </span>
                    <span className="guide__gloss">{w.gloss || <span className="guide__muted">No gloss</span>}</span>
                    <span className="guide__muted">heard {times(w.count)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </>
    );

  return (
    <>
      <ScreenHeader>
        <button type="button" className="btn btn--link" onClick={onBack}>
          ← Back to Sessions
        </button>
      </ScreenHeader>
      <div className="guide__heading">
        <h1>Session Guide</h1>
        <p className="guide__muted">
          {formatStart(session.startedAt)} · {sessionDuration(session, Date.now())} · Replay coming soon
        </p>
      </div>
      {body}
    </>
  );
}
