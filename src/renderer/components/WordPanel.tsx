import { useEffect, useRef, useState } from 'react';
import type { Token } from '../../core/types';
import type { WordDetails } from '../bridge';
import { Badge } from './Badge';
import { DetailSections } from './DetailSections';
import './WordPanel.css';

export type LoadWordDetails = (lemmaId: number, surface: string) => Promise<WordDetails | null>;

/** Ignores a Lemma (GLOSSARY: Ignored Lemma), or stops ignoring it with false. */
export type SetIgnored = (lemmaId: number, lemma: string, ignored: boolean) => void;

type Load =
  | { state: 'loading' }
  | { state: 'loaded'; details: WordDetails | null }
  | { state: 'failed'; message: string };

function Message({ children }: { children: string }) {
  return <p className="word-panel__message">{children}</p>;
}

/**
 * The click-a-word panel: the clicked word, then its Lemma's Detail Module sections in
 * configured order. A word not analyzed yet has no Lemma, so nothing to look up.
 */
export function WordPanel({
  token,
  loadDetails,
  onClose,
  onSetIgnored,
  unanalyzedNote = 'Details appear once this word has been analyzed.',
}: {
  token: Token;
  loadDetails: LoadWordDetails;
  onClose: () => void;
  /** Offers Ignore, or Stop ignoring, for the word's Lemma once its details are in. */
  onSetIgnored?: SetIgnored;
  /** Shown for a word with no Lemma. */
  unanalyzedNote?: string;
}) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { lemmaId, surface } = token;
  /** The word the shown details are for; reloading the same word keeps them on screen. */
  const shownFor = useRef<string | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [surface, lemmaId]);

  useEffect(() => {
    if (lemmaId === null) return;
    let current = true;
    const key = `${lemmaId} ${surface}`;
    if (shownFor.current !== key) setLoad({ state: 'loading' });
    loadDetails(lemmaId, surface)
      .then((details) => {
        if (!current) return;
        shownFor.current = key;
        setLoad({ state: 'loaded', details });
      })
      .catch((err: Error) => {
        if (!current) return;
        shownFor.current = null;
        setLoad({ state: 'failed', message: err.message });
      });
    return () => {
      current = false;
    };
  }, [lemmaId, surface, loadDetails]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  let body;
  if (lemmaId === null) body = <Message>{unanalyzedNote}</Message>;
  else if (load.state === 'loading') body = <Message>Loading…</Message>;
  else if (load.state === 'failed') body = <Message>{`Could not load this word’s details: ${load.message}`}</Message>;
  else if (!load.details || load.details.sections.length === 0) body = <Message>No details for this word yet.</Message>;
  else body = <DetailSections sections={load.details.sections} />;

  const details = load.state === 'loaded' && lemmaId !== null ? load.details : null;
  const ignoring =
    details && onSetIgnored ? (
      <p className="word-panel__ignore">
        {details.ignored && <Badge kind="ignored">Ignored</Badge>}
        <button
          type="button"
          className="btn btn--link"
          aria-label={`${details.ignored ? 'Stop ignoring' : 'Ignore'} ${details.lemma}`}
          onClick={() => onSetIgnored(details.lemmaId, details.lemma, !details.ignored)}
        >
          {details.ignored ? 'Stop ignoring' : 'Ignore'}
        </button>
      </p>
    ) : null;

  return (
    <aside className="word-panel" aria-label="Word details">
      <header className="word-panel__header">
        <div>
          <h2 className="word-panel__word" lang="ar" dir="rtl" tabIndex={-1} ref={headingRef}>
            {surface}
          </h2>
          {token.gloss && <p className="word-panel__gloss">{token.gloss}</p>}
          {ignoring}
        </div>
        <button type="button" className="btn btn--link word-panel__close" onClick={onClose} aria-label="Close word details">
          ✕
        </button>
      </header>
      <div className="word-panel__body">{body}</div>
    </aside>
  );
}
