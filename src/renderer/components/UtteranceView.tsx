import { isArabicWord } from '../../core/analysis/align';
import type { LiveUtterance } from '../bridge';
import './UtteranceView.css';

function ArabicText({ text }: { text: string }) {
  return (
    <p className="utterance__arabic" dir="rtl" lang="ar">
      {text}
    </p>
  );
}

/**
 * One Utterance: muted Arabic while interim; once final, word columns with their glosses
 * (plain Arabic until glosses exist) plus the sentence translation. Each Arabic word column
 * opens the word panel when clicked; a Foreign word shows as heard, with no gloss or click.
 */
export function UtteranceView({
  utterance,
  selectedWord = null,
  onSelectWord,
}: {
  utterance: LiveUtterance;
  /** Position of the word whose panel is open, if it is in this Utterance. */
  selectedWord?: number | null;
  onSelectWord?: (position: number) => void;
}) {
  if (!utterance.isFinal) {
    return (
      <article className="utterance utterance--interim" data-state="interim">
        <ArabicText text={utterance.text} />
      </article>
    );
  }
  return (
    <article className="utterance" data-state="final">
      {utterance.tokens.some((t) => t.gloss) ? (
        <div className="utterance__words" dir="rtl">
          {utterance.tokens.map((t, i) => (
            <span key={i} className={i === selectedWord ? 'word word--selected' : 'word'} role="group">
              {onSelectWord && isArabicWord(t.surface) ? (
                <button
                  type="button"
                  className="word__ar word__button"
                  lang="ar"
                  aria-pressed={i === selectedWord}
                  aria-label={`Show details for ${t.surface}`}
                  onClick={() => onSelectWord(i)}
                >
                  {t.surface}
                </button>
              ) : (
                <span className="word__ar" lang="ar">
                  {t.surface}
                </span>
              )}
              <span className="word__gloss" lang="en" dir="ltr">
                {t.gloss}
              </span>
            </span>
          ))}
        </div>
      ) : (
        <ArabicText text={utterance.text} />
      )}
      {utterance.translation && (
        <p className="utterance__translation" dir="ltr">
          {utterance.translation}
        </p>
      )}
    </article>
  );
}
