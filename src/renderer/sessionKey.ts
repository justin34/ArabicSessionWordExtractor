import type { ListedSession } from './bridge';

const DEMO_PREFIX = 'demo-';

/** Stable identity across real and Demo Sessions, whose numeric ids are unrelated. */
export const sessionKey = (s: ListedSession): string =>
  s.isDemo ? `${DEMO_PREFIX}${s.id}` : String(s.id);

export const isDemoKey = (key: string): boolean => key.startsWith(DEMO_PREFIX);
