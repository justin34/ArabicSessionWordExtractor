import type { ReactNode } from 'react';
import './ScreenHeader.css';

/** Title row shared by every top-level screen; actions sit at the end. */
export function ScreenHeader({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="screen-header">
      {title && <h1>{title}</h1>}
      {children && <div className="screen-header__actions">{children}</div>}
    </div>
  );
}
