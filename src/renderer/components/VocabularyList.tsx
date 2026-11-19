import type { VocabularyEntry } from '../bridge';
import { formatStart } from '../format';
import { useAnkiExport, type AnkiActions } from './AnkiExport';
import { matchesVocabulary } from '../vocabularySearch';
import { Badge } from './Badge';
import { EmptyState } from './EmptyState';
import { ScreenHeader } from './ScreenHeader';
import type { SetIgnored } from './WordPanel';
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

const wordCount = (n: number) => `${n} ${n === 1 ? 'word' : 'words'}`;

/**
 * "412 words · 23 ignored": Ignored Lemmas are left out of the word count and counted on
 * their own; while searching, each says how many of them match. The Ignored filter counts
 * only those.
 */
function countLine(entries: VocabularyEntry[], shown: VocabularyEntry[], searching: boolean, ignoredOnly: boolean): string {
  const ignored = entries.filter((e) => e.ignored).length;
  const shownIgnored = shown.filter((e) => e.ignored).length;
  const ignoredPart = searching ? `${shownIgnored} of ${ignored} ignored` : `${ignored} ignored`;
  if (ignoredOnly) return ignoredPart;
  const words = entries.length - ignored;
  const shownWords = shown.length - shownIgnored;
  const wordsPart = searching ? `${shownWords} of ${wordCount(words)}` : wordCount(words);
  return ignored > 0 ? `${wordsPart} · ${ignoredPart}` : wordsPart;
}

/** "Export to Anki" here exports every Lemma that is not ignored. */
const VOCABULARY = { kind: 'vocabulary' } as const;

/**
 * The Vocabulary: every Lemma heard, searchable by Arabic, root or English. Ignored Lemmas
 * stay listed, marked, and the Ignored filter lists only them.
 */
export function VocabularyList({
  entries,
  query,
  onQueryChange,
  ignoredOnly,
  onIgnoredOnlyChange,
  onOpenWord,
  onSetIgnored,
  anki,
}: {
  /** Null while loading. */
  entries: VocabularyEntry[] | null;
  query: string;
  onQueryChange: (query: string) => void;
  /** The Ignored filter: only Ignored Lemmas are listed. */
  ignoredOnly: boolean;
  onIgnoredOnlyChange: (ignoredOnly: boolean) => void;
  /** Opens a Lemma's Word Card. */
  onOpenWord: (lemmaId: number) => void;
  onSetIgnored: SetIgnored;
  anki: AnkiActions;
}) {
  const ankiExport = useAnkiExport(anki, VOCABULARY);
  const shown = entries?.filter((e) => (!ignoredOnly || e.ignored) && matchesVocabulary(e, query)) ?? [];
  const anyIgnored = entries?.some((e) => e.ignored) ?? false;
  const studied = entries?.filter((e) => !e.ignored).length ?? 0;
  const searching = query.trim() !== '';
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
        {entries !== null && (anyIgnored || ignoredOnly) && (
          <button
            type="button"
            className="btn vocab-filter"
            aria-pressed={ignoredOnly}
            onClick={() => onIgnoredOnlyChange(!ignoredOnly)}
          >
            Ignored
          </button>
        )}
        {entries !== null && ankiExport.button(studied === 0)}
      </ScreenHeader>
      {ankiExport.status}
      {entries === null ? null : entries.length === 0 ? (
        <EmptyState title="No words yet">
          Every word you hear in a Session collects here, by its dictionary form.
        </EmptyState>
      ) : shown.length === 0 && ignoredOnly && (!searching || !anyIgnored) ? (
        <EmptyState title="No ignored words">Words you ignore stay here, out of your guides and Anki exports.</EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState title="No matching words">
          Nothing {ignoredOnly ? 'you have ignored' : 'in your Vocabulary'} matches “{query}”.
        </EmptyState>
      ) : (
        <>
          <p className="vocab-count">{countLine(entries, shown, searching, ignoredOnly)}</p>
          <ul className="vocab-list" aria-label="Vocabulary list">
            {shown.map((e) => (
              <li key={e.lemmaId} className={`vocab-row${e.ignored ? ' vocab-row--ignored' : ''}`} aria-label={e.lemma}>
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
                  <div className="vocab-row__ignore">
                    {e.ignored && <Badge kind="ignored">Ignored</Badge>}
                    <button
                      type="button"
                      className="btn btn--link"
                      aria-label={`${e.ignored ? 'Stop ignoring' : 'Ignore'} ${e.lemma}`}
                      onClick={() => onSetIgnored(e.lemmaId, e.lemma, !e.ignored)}
                    >
                      {e.ignored ? 'Stop ignoring' : 'Ignore'}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
