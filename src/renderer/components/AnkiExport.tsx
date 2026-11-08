import { useEffect, useRef, useState } from 'react';
import type { AnkiExportResult, AnkiExportTarget } from '../bridge';
import './AnkiExport.css';

/** What the export buttons need from the bridge. */
export interface AnkiActions {
  exportToAnki(target: AnkiExportTarget): Promise<AnkiExportResult | null>;
  showExportedFile(path: string): Promise<void>;
}

type ExportState =
  | { kind: 'idle' }
  | { kind: 'exporting' }
  | { kind: 'done'; result: AnkiExportResult }
  | { kind: 'failed'; message: string };

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const words = (n: number) => (n === 1 ? '1 word' : `${n} words`);

export const VOICE_NOTE =
  "Cards speak each word with your device's Arabic voice; on Windows, add it under Settings › Time & language › Speech.";

/**
 * "Export to Anki" (GLOSSARY: Anki export): the button, and the confirmation or failure
 * shown after it. The main process asks where to save; nothing is recorded afterwards.
 */
export function useAnkiExport(anki: AnkiActions, target: AnkiExportTarget) {
  const [state, setState] = useState<ExportState>({ kind: 'idle' });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function run(): Promise<void> {
    setState({ kind: 'exporting' });
    try {
      const result = await anki.exportToAnki(target);
      if (mounted.current) setState(result ? { kind: 'done', result } : { kind: 'idle' });
    } catch (err) {
      if (mounted.current) setState({ kind: 'failed', message: (err as Error).message });
    }
  }

  const button = (disabled: boolean) => (
    <button
      type="button"
      className="btn"
      disabled={disabled || state.kind === 'exporting'}
      onClick={() => void run()}
    >
      {state.kind === 'exporting' ? 'Exporting…' : 'Export to Anki'}
    </button>
  );

  const dismiss = () => setState({ kind: 'idle' });
  let status = null;
  if (state.kind === 'done') {
    const { count, path } = state.result;
    status = (
      <div className="anki-export anki-export--done" role="status">
        <p className="anki-export__line">
          Exported {words(count)} to {fileName(path)}.{' '}
          <button
            type="button"
            className="btn btn--link"
            onClick={() => void anki.showExportedFile(path).catch(() => undefined)}
          >
            Show in folder
          </button>
        </p>
        <p className="anki-export__note">{VOICE_NOTE}</p>
        <button type="button" className="btn btn--link anki-export__dismiss" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    );
  } else if (state.kind === 'failed') {
    status = (
      <div className="anki-export anki-export--failed" role="alert">
        <p className="anki-export__line">Could not export to Anki: {state.message}</p>
        <button type="button" className="btn btn--link anki-export__dismiss" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    );
  }
  return { button, status };
}
