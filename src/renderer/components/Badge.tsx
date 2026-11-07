import type { ReactNode } from 'react';
import './Badge.css';

export type BadgeKind = 'recording' | 'completed' | 'demo';

export function Badge({ kind, children }: { kind: BadgeKind; children: ReactNode }) {
  return <span className={`badge badge--${kind}`}>{children}</span>;
}
