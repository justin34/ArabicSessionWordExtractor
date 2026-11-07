import { Component, type ReactNode } from 'react';
import type { DetailBlock, DetailSection } from '../../core/types';
import './DetailSections.css';

function Arabic({ children }: { children: ReactNode }) {
  return (
    <span lang="ar" dir="rtl" className="detail__arabic">
      {children}
    </span>
  );
}

function Block({ block }: { block: DetailBlock }) {
  switch (block.kind) {
    case 'facts':
      return (
        <dl className="detail__facts">
          {block.facts.map((f, i) => (
            <div key={i} className="detail__fact">
              <dt>{f.label}</dt>
              <dd>{f.arabic ? <Arabic>{f.value}</Arabic> : f.value}</dd>
            </div>
          ))}
        </dl>
      );
    case 'list': {
      const items = block.items.map((item, i) => (
        <li key={i}>
          {item.text}
          {item.note && <span className="detail__note"> · {item.note}</span>}
        </li>
      ));
      return block.ordered ? <ol className="detail__list">{items}</ol> : <ul className="detail__list">{items}</ul>;
    }
    case 'text':
      return (
        <div className="detail__text">
          {block.heading && <h4>{block.heading}</h4>}
          <p>{block.text}</p>
        </div>
      );
    case 'examples':
      return (
        <ul className="detail__examples">
          {block.examples.map((e, i) => (
            <li key={i} className="detail__example">
              <p className="detail__example-ar" lang="ar" dir="rtl">
                {e.arabic}
              </p>
              {e.english && <p className="detail__example-en">{e.english}</p>}
              {e.note && <p className="detail__note">{e.note}</p>}
            </li>
          ))}
        </ul>
      );
    default:
      // A kind this build does not know is left out.
      return null;
  }
}

/** Leaves out one section that fails to render, so the rest still show (ADR 0002). */
class SectionBoundary extends Component<{ moduleId: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`Detail Module "${this.props.moduleId}" could not be shown:`, error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Detail Module sections, in the order given. Used by the word panel (and later Word Cards). */
export function DetailSections({ sections }: { sections: DetailSection[] }) {
  return (
    <>
      {sections.map((s) => (
        <SectionBoundary key={s.moduleId} moduleId={s.moduleId}>
          <section className="detail" aria-label={s.title} data-module={s.moduleId}>
            <h3 className="detail__title">{s.title}</h3>
            {s.blocks.map((b, i) => (
              <Block key={i} block={b} />
            ))}
          </section>
        </SectionBoundary>
      ))}
    </>
  );
}
