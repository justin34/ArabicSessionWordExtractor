/**
 * "Export to Anki" (GLOSSARY: Anki export): one-way and stateless. Each export is built
 * fresh from the Vocabulary as it is now, and nothing is recorded about it.
 */
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { Dictionary } from '../providers';
import type { Store } from '../store';
import type { AnkiExportTarget } from '../types';
import { ankiNote, localDate } from './notes';
import { ankiPackage, FONT_FILE, type AnkiMedia, type AnkiNote } from './package';

export interface AnkiExporterOptions {
  /** The Arabic font the cards show the Lemma in, packaged with the deck when it exists. */
  fontPath?: string;
  /** The current time, for file names and the collection; now by default. */
  now?: () => number;
}

export class AnkiExporter {
  private readonly now: () => number;

  constructor(
    private readonly store: Store,
    private readonly dictionary: Dictionary,
    private readonly options: AnkiExporterOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  /**
   * The Lemmas an export holds, in the order heard: every Lemma of the Vocabulary, or a
   * Session's new Lemmas, exactly as its Session Guide lists them. Ignored Lemmas never are.
   */
  lemmaIds(target: AnkiExportTarget): number[] {
    if (target.kind === 'vocabulary') {
      return this.store
        .listVocabulary()
        .filter((e) => !e.ignored)
        .map((e) => e.lemmaId)
        .reverse();
    }
    const guide = this.store.getSessionGuide(target.sessionId);
    return guide?.groups.flatMap((g) => g.words.map((w) => w.lemmaId)) ?? [];
  }

  /** The Save dialog's suggested file name. */
  defaultFileName(target: AnkiExportTarget): string {
    if (target.kind === 'vocabulary') return `arabic-vocabulary-${localDate(this.now())}.apkg`;
    return `session-${localDate(this.store.getSession(target.sessionId).startedAt)}-new-words.apkg`;
  }

  /** The notes an export holds. */
  async notes(target: AnkiExportTarget): Promise<AnkiNote[]> {
    const notes: AnkiNote[] = [];
    for (const id of this.lemmaIds(target)) {
      const note = await ankiNote(this.store, this.dictionary, id);
      if (note) notes.push(note);
    }
    return notes;
  }

  /**
   * Writes the export to `path` and returns how many words it holds. The file appears
   * whole or not at all: a failed write leaves no partial file behind.
   */
  async export(target: AnkiExportTarget, path: string): Promise<number> {
    if (target.kind === 'session') this.store.getSession(target.sessionId);
    const notes = await this.notes(target);
    if (notes.length === 0) throw new Error(this.nothingToExport(target));
    const bytes = ankiPackage(notes, this.media(), this.now());
    const partial = `${path}.${process.pid}-${this.now()}.part`;
    try {
      writeFileSync(partial, bytes);
      renameSync(partial, path);
    } catch (err) {
      rmSync(partial, { force: true });
      throw new Error(`The deck could not be saved: ${(err as Error).message}`);
    }
    return notes.length;
  }

  private nothingToExport(target: AnkiExportTarget): string {
    if (target.kind === 'session') return 'This Session has no new words.';
    return this.store.listVocabulary().length === 0
      ? 'Your Vocabulary has no words yet.'
      : 'Every word in your Vocabulary is ignored.';
  }

  private media(): AnkiMedia[] {
    const { fontPath } = this.options;
    if (!fontPath || !existsSync(fontPath)) return [];
    try {
      return [{ name: FONT_FILE, data: new Uint8Array(readFileSync(fontPath)) }];
    } catch (err) {
      console.warn(`The Arabic font at ${fontPath} could not be read; cards use the device's own:`, err);
      return [];
    }
  }
}
