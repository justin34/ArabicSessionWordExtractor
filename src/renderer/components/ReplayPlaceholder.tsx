import { EmptyState } from './EmptyState';

export function ReplayPlaceholder({ onBack }: { onBack: () => void }) {
  return (
    <>
      <div className="screen__header">
        <button type="button" className="btn btn--link" onClick={onBack}>
          ← Back to Sessions
        </button>
      </div>
      <EmptyState title="Replay coming soon">
        You will be able to play this Session back with the transcript highlighted.
      </EmptyState>
    </>
  );
}
