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
 * (plain Arabic until glosses exist) plus the sentence translation.
 */
export function UtteranceView({ utterance }: { utterance: LiveUtterance }) {
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
            <span key={i} className="word" role="group">
              <span className="word__ar" lang="ar">
                {t.surface}
              </span>
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
