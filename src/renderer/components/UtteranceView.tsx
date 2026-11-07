import type { LiveUtterance } from '../bridge';
import './UtteranceView.css';

/** One Utterance: muted Arabic while interim, word columns plus translation once final. */
export function UtteranceView({ utterance }: { utterance: LiveUtterance }) {
  if (!utterance.isFinal) {
    return (
      <article className="utterance utterance--interim" data-state="interim">
        <p className="utterance__interim-text" dir="rtl" lang="ar">
          {utterance.text}
        </p>
      </article>
    );
  }
  return (
    <article className="utterance" data-state="final">
      {utterance.tokens.length > 0 ? (
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
        <p className="utterance__interim-text" dir="rtl" lang="ar">
          {utterance.text}
        </p>
      )}
      {utterance.translation && (
        <p className="utterance__translation" dir="ltr">
          {utterance.translation}
        </p>
      )}
    </article>
  );
}
