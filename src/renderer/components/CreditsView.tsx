import { useEffect, useState } from 'react';
import { APP_NAME } from '../../core/appIdentity';
import { CREDITS, LICENSE_TEXTS, type Credit } from '../credits';
import { ScreenHeader } from './ScreenHeader';
import './CreditsView.css';

function LicenceText({ file }: { file: string }) {
  const [open, setOpen] = useState(false);
  const text = LICENSE_TEXTS[file];
  if (text === undefined) return null;
  return (
    <div className="credit__licence">
      <button type="button" className="btn btn--link" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide' : 'Show'} licence text ({file})
      </button>
      {open && (
        <pre className="credit__text" tabIndex={0} aria-label={`Licence text: ${file}`}>
          {text}
        </pre>
      )}
    </div>
  );
}

function CreditItem({ credit }: { credit: Credit }) {
  return (
    <li className="credit">
      <div className="credit__head">
        <a href={credit.url} target="_blank" rel="noreferrer" className="credit__name">
          {credit.name}
        </a>
        <span className="credit__licence-name">{credit.licence}</span>
      </div>
      <p className="credit__use">{credit.use}</p>
      <p className="credit__by">By {credit.by}.</p>
      {credit.note && <p className="credit__by">{credit.note}</p>}
      {credit.files.map((f) => (
        <LicenceText key={f} file={f} />
      ))}
    </li>
  );
}

/** Credits and licences: every data source and component the app is built from. */
export function CreditsView({ loadDictionaryNotice }: { loadDictionaryNotice: () => Promise<string | null> }) {
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    loadDictionaryNotice()
      .then((text) => current && setNotice(text))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [loadDictionaryNotice]);

  return (
    <>
      <ScreenHeader title="Credits and licences" />
      <div className="credits">
        <h2 className="credits__app">{APP_NAME}</h2>
        <p className="credits__intro">
          Free software under the GNU General Public License, version 2 or later. It is built on open data
          and open-source software. Thank you to everyone who made them.
        </p>
        {CREDITS.map((group) => (
          <section key={group.title} className="credits__group" aria-labelledby={`credits-${group.title}`}>
            <h2 id={`credits-${group.title}`}>{group.title}</h2>
            <ul className="credits__list">
              {group.credits.map((c) => (
                <CreditItem key={c.name} credit={c} />
              ))}
            </ul>
          </section>
        ))}
        {notice && (
          <section className="credits__group" aria-labelledby="credits-dictionary">
            <h2 id="credits-dictionary">Bundled dictionary</h2>
            <pre className="credit__text" tabIndex={0} aria-label="Dictionary notice">
              {notice}
            </pre>
          </section>
        )}
      </div>
    </>
  );
}
