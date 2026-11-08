import type { VocabularyEntry } from '../bridge';
import { formatStart } from '../format';
import { useAnkiExport, type AnkiActions } from './AnkiExport';
import { matchesVocabulary } from '../vocabularySearch';
import { EmptyState } from './EmptyState';
import { ScreenHeader } from './ScreenHeader';
import './VocabularyList.css';

/** CAMeL's stem gloss reads like `make_walk;adjust`; show it as plain English. */
function readableGloss(stemGloss: string): string {
  return stemGloss.replace(/_/g, ' ').replace(/;/g, ', ');
}

/** CAMeL marks words without a true root (particles, loanwords) with # radicals. */
function learnableRoot(root: string | null): string | null {
  return root && !root.includes('#') ? root : null;
}

function heardSummary(e: VocabularyEntry): string {
  const sessions = new Set(e.heardIn.map((h) => h.sessionId)).size;
  const times = e.count === 1 ? 'once' : `${e.count} times`;
  return `Heard ${times} in ${sessions === 1 ? '1 Session' : `${sessions} Sessions`}`;
}

/** "Export to Anki" here exports every Lemma. */
const VOCABULARY = { kind: 'vocabulary' } as const;

/** The Vocabulary: every Lemma heard, searchable by Arabic, root or English. */
export function VocabularyList({
  entries,
  query,
  onQueryChange,
  onOpenWord,
  anki,
}: {
  /** Null while loading. */
  entries: VocabularyEntry[] | null;
  query: string;
  onQueryChange: (query: string) => void;
  /** Opens a Lemma's Word Card. */
  onOpenWord: (lemmaId: number) => void;
  anki: AnkiActions;
}) {
  const ankiExport = useAnkiExport(anki, VOCABULARY);
  const shown = entries?.filter((e) => matchesVocabulary(e, query)) ?? [];
  return (
    <>
      <ScreenHeader title="Vocabulary">
        {entries !== null && entries.length > 0 && (
          <input
            type="search"
            dir="auto"
            className="vocab-search"
            aria-label="Search vocabulary"
            placeholder="Search Arabic, root or English"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
        )}
        {entries !== null && ankiExport.button(entries.length === 0)}
      </ScreenHeader>
      {ankiExport.status}
      {entries === null ? null : entries.length === 0 ? (
        <EmptyState title="No words yet">
          Every word you hear in a Session collects here, by its dictionary form.
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState title="No matching words">Nothing in your Vocabulary matches “{query}”.</EmptyState>
      ) : (
        <>
          <p className="vocab-count">
            {shown.length === entries.length
              ? `${entries.length} ${entries.length === 1 ? 'word' : 'words'}`
              : `${shown.length} of ${entries.length} words`}
          </p>
          <ul className="vocab-list" aria-label="Vocabulary list">
            {shown.map((e) => (
              <li key={e.lemmaId} className="vocab-row" aria-label={e.lemma}>
                <button
                  type="button"
                  className="vocab-row__lemma"
                  lang="ar"
                  dir="rtl"
                  aria-label={`Word Card for ${e.lemma}`}
                  onClick={() => onOpenWord(e.lemmaId)}
                >
                  {e.lemma}
                </button>
                <div className="vocab-row__body">
                  <div className="vocab-row__gloss">
                    {e.stemGloss ? readableGloss(e.stemGloss) : <span className="vocab-row__muted">No gloss yet</span>}
                  </div>
                  <div className="vocab-row__meta">
                    {e.partOfSpeech}
                    {e.partOfSpeech && learnableRoot(e.root) && ' · '}
                    {learnableRoot(e.root) && (
                      <>
                        root{' '}
                        <span lang="ar" dir="rtl">
                          {learnableRoot(e.root)}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="vocab-row__forms">
                    Heard as{' '}
                    <span lang="ar" dir="rtl" className="vocab-row__form">
                      {e.surfaceForms.join('، ')}
                    </span>
                  </div>
                </div>
                <div className="vocab-row__stats">
                  <div>{heardSummary(e)}</div>
                  <div className="vocab-row__muted">First heard {formatStart(e.firstHeardAt)}</div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
