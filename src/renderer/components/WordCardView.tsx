import { useCallback } from 'react';
import type { WordCard } from '../bridge';
import { formatStart } from '../format';
import { useLoaded } from '../useLoaded';
import { DetailSections } from './DetailSections';
import { EmptyState } from './EmptyState';
import { ScreenHeader } from './ScreenHeader';
import './StudyGuides.css';

/** A Lemma's read-only Word Card: its Detail Module sections as generated. */
export function WordCardView({
  lemmaId,
  loadCard,
  backLabel,
  onBack,
}: {
  lemmaId: number;
  loadCard: (lemmaId: number) => Promise<WordCard | null>;
  backLabel: string;
  onBack: () => void;
}) {
  const load = useCallback(() => loadCard(lemmaId), [loadCard, lemmaId]);
  const card = useLoaded(load);

  let body;
  if (card.state === 'loading') body = null;
  else if (card.state === 'failed') body = <EmptyState title="Could not load this Word Card">{card.message}</EmptyState>;
  else if (!card.value)
    body = <EmptyState title="No Word Card yet">It is generated once the word is in your Vocabulary.</EmptyState>;
  else
    body = (
      <>
        <div className="guide__heading">
          <h1 className="card__lemma" lang="ar" dir="rtl">
            {card.value.lemma}
          </h1>
          <p className="guide__muted">Word Card · updated {formatStart(card.value.updatedAt)}</p>
        </div>
        {card.value.sections.length === 0 ? (
          <EmptyState title="No details for this word yet" />
        ) : (
          <div className="card__sections">
            <DetailSections sections={card.value.sections} />
          </div>
        )}
      </>
    );

  return (
    <>
      <ScreenHeader>
        <button type="button" className="btn btn--link" onClick={onBack}>
          ← {backLabel}
        </button>
      </ScreenHeader>
      {body}
    </>
  );
}
