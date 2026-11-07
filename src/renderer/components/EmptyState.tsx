import type { ReactNode } from 'react';
import './EmptyState.css';

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__title">{title}</div>
      {children && <p>{children}</p>}
    </div>
  );
}
