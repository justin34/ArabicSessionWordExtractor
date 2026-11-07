import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WordDetailsBuilder, type DetailModuleConfig } from './details/wordDetails';
import type { Providers } from './providers';
import { Sessions } from './sessions';
import { Store } from './store';
import type { VocabularyEntry, WordDetails } from './types';

/** The Vocabulary, built by the Session pipeline as Utterances are analyzed. */
export interface Vocabulary {
  list(): VocabularyEntry[];
}

/** The click-a-word panel's content. */
export interface Words {
  /** The Detail Module sections for a Lemma; `surface` is the form clicked. */
  details(lemmaId: number, surface?: string): Promise<WordDetails | undefined>;
}

export interface App {
  sessions: Sessions;
  vocabulary: Vocabulary;
  words: Words;
  close(): void;
}

export interface AppOptions {
  dataDir: string;
  providers: Providers;
  /** Detail Modules for the word panel, in order; all built-ins by default. */
  detailModules?: DetailModuleConfig;
}

/** Wires local storage and the providers into the Session pipeline. */
export function createApp({ dataDir, providers, detailModules }: AppOptions): App {
  mkdirSync(dataDir, { recursive: true });
  const store = new Store(join(dataDir, 'app.db'));
  const sessions = new Sessions(store, providers, join(dataDir, 'recordings'));
  const vocabulary: Vocabulary = { list: () => store.listVocabulary() };
  const builder = new WordDetailsBuilder(store, { store, dictionary: providers.dictionary }, detailModules);
  const words: Words = { details: (lemmaId, surface) => builder.details(lemmaId, surface) };
  return { sessions, vocabulary, words, close: () => store.close() };
}
