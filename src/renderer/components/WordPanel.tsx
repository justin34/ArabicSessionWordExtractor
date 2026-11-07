import { useEffect, useRef, useState } from 'react';
import type { Token } from '../../core/types';
import type { WordDetails } from '../bridge';
import { DetailSections } from './DetailSections';
import './WordPanel.css';

export type LoadWordDetails = (lemmaId: number, surface: string) => Promise<WordDetails | null>;

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
}: {
  token: Token;
  loadDetails: LoadWordDetails;
  onClose: () => void;
}) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { lemmaId, surface } = token;

  useEffect(() => {
    headingRef.current?.focus();
  }, [surface, lemmaId]);

  useEffect(() => {
    if (lemmaId === null) return;
    let current = true;
    setLoad({ state: 'loading' });
    loadDetails(lemmaId, surface)
      .then((details) => current && setLoad({ state: 'loaded', details }))
      .catch((err: Error) => current && setLoad({ state: 'failed', message: err.message }));
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
  if (lemmaId === null) body = <Message>Details appear once this word has been analyzed.</Message>;
  else if (load.state === 'loading') body = <Message>Loading…</Message>;
  else if (load.state === 'failed') body = <Message>{`Could not load this word’s details: ${load.message}`}</Message>;
  else if (!load.details || load.details.sections.length === 0) body = <Message>No details for this word yet.</Message>;
  else body = <DetailSections sections={load.details.sections} />;

  return (
    <aside className="word-panel" aria-label="Word details">
      <header className="word-panel__header">
        <div>
          <h2 className="word-panel__word" lang="ar" dir="rtl" tabIndex={-1} ref={headingRef}>
            {surface}
          </h2>
          {token.gloss && <p className="word-panel__gloss">{token.gloss}</p>}
        </div>
        <button type="button" className="btn btn--link word-panel__close" onClick={onClose} aria-label="Close word details">
          ✕
        </button>
      </header>
      <div className="word-panel__body">{body}</div>
    </aside>
  );
}
