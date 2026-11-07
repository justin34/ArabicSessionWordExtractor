import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Providers } from './providers';
import { Sessions } from './sessions';
import { Store } from './store';

export interface App {
  sessions: Sessions;
  close(): void;
}

export interface AppOptions {
  dataDir: string;
  providers: Providers;
}

/** Wires local storage and the providers into the Session pipeline. */
export function createApp({ dataDir, providers }: AppOptions): App {
  mkdirSync(dataDir, { recursive: true });
  const store = new Store(join(dataDir, 'app.db'));
  const sessions = new Sessions(store, providers, join(dataDir, 'recordings'));
  return { sessions, close: () => store.close() };
}
