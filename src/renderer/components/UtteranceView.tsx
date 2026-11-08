import type { MouseEvent } from 'react';
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

/** Marks a Learner Utterance: the learner's own speech, never analyzed (ADR 0004). */
function LearnerLabel() {
  return <span className="utterance__speaker">You</span>;
}

/**
 * One Utterance: muted Arabic while interim; once final, word columns with their glosses
 * (plain Arabic until glosses exist) plus the sentence translation. Each Arabic word column
 * opens the word panel when clicked; a Foreign word shows as heard, with no gloss or click.
 * A Learner Utterance is marked "You" in its own tint: plain Arabic and its translation,
 * with no glosses and no word panel. In Replay it is lit and seeks like any other, and
 * its words are lit as heard.
 */
export function UtteranceView({
  utterance,
  selectedWord = null,
  onSelectWord,
  replay,
}: {
  utterance: LiveUtterance;
  /** Position of the word whose panel is open, if it is in this Utterance. */
  selectedWord?: number | null;
  onSelectWord?: (position: number) => void;
  /**
   * Set in Replay View: words show as columns even without glosses, the word being heard
   * is highlighted, and clicking the sentence (or its time) seeks to it.
   */
  replay?: {
    /** True while playback is inside this Utterance. */
    current: boolean;
    /** Position of the word being heard, if it is in this Utterance. */
    currentWord: number | null;
    /** When the Utterance starts, e.g. 1:05. */
    time: string;
    onSeek: () => void;
  };
}) {
  const seekButton = replay && (
    <button type="button" className="utterance__seek" aria-label={`Play from ${replay.time}`} onClick={replay.onSeek}>
      {replay.time}
    </button>
  );
  // Clicking anywhere in the sentence but a word seeks; the time button does it from the keyboard.
  const seekOnClick =
    replay &&
    ((e: MouseEvent) => {
      if (!(e.target as Element).closest('.word__button, .utterance__seek')) replay.onSeek();
    });

  if (utterance.track === 'mic') {
    const classes = ['utterance', 'utterance--learner', !utterance.isFinal && 'utterance--interim', replay?.current && 'utterance--current'];
    // In Replay its words are lit as heard, but open nothing: a Learner Utterance has no glosses.
    const heardWords = replay && utterance.isFinal && utterance.tokens.length > 0;
    return (
      <article
        className={classes.filter(Boolean).join(' ')}
        data-state={utterance.isFinal ? 'final' : 'interim'}
        data-track="mic"
        aria-current={replay?.current ? 'true' : undefined}
        onClick={seekOnClick}
      >
        {seekButton}
        <LearnerLabel />
        {heardWords ? (
          <div className="utterance__words utterance__words--learner" dir="rtl">
            {utterance.tokens.map((t, i) => (
              <span
                key={i}
                className={i === replay.currentWord ? 'word word--current' : 'word'}
                role="group"
                aria-current={i === replay.currentWord ? 'true' : undefined}
              >
                <span className="word__ar" lang="ar">
                  {t.surface}
                </span>
              </span>
            ))}
          </div>
        ) : (
          <ArabicText text={utterance.text} />
        )}
        {utterance.isFinal && utterance.translation && (
          <p className="utterance__translation" dir="ltr">
            {utterance.translation}
          </p>
        )}
      </article>
    );
  }
  if (!utterance.isFinal) {
    return (
      <article className="utterance utterance--interim" data-state="interim">
        <ArabicText text={utterance.text} />
      </article>
    );
  }
  const showWords = utterance.tokens.length > 0 && (replay !== undefined || utterance.tokens.some((t) => t.gloss));
  const wordClass = (i: number) =>
    ['word', i === selectedWord && 'word--selected', i === replay?.currentWord && 'word--current']
      .filter(Boolean)
      .join(' ');
  return (
    <article
      className={replay?.current ? 'utterance utterance--current' : 'utterance'}
      data-state="final"
      aria-current={replay?.current ? 'true' : undefined}
      onClick={seekOnClick}
    >
      {seekButton}
      {showWords ? (
        <div className="utterance__words" dir="rtl">
          {utterance.tokens.map((t, i) => (
            <span
              key={i}
              className={wordClass(i)}
              role="group"
              aria-current={i === replay?.currentWord ? 'true' : undefined}
            >
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
