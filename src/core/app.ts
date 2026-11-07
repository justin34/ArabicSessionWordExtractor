import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Providers } from './providers';
import { SessionService } from './sessions';
import { Store } from './store';

export interface App {
  sessions: SessionService;
  providers: Providers;
  close(): void;
}

export interface AppOptions {
  dataDir: string;
  providers: Providers;
}

export function createApp(options: AppOptions): App {
  mkdirSync(options.dataDir, { recursive: true });
  const store = new Store(join(options.dataDir, 'app.db'));
  const sessions = new SessionService(
    store,
    options.providers,
    join(options.dataDir, 'recordings'),
  );
  return { sessions, providers: options.providers, close: () => store.close() };
}
