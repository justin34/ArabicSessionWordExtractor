import { EmptyState } from './EmptyState';
import { ScreenHeader } from './ScreenHeader';

export function ReplayPlaceholder({ onBack }: { onBack: () => void }) {
  return (
    <>
      <ScreenHeader>
        <button type="button" className="btn btn--link" onClick={onBack}>
          ← Back to Sessions
        </button>
      </ScreenHeader>
      <EmptyState title="Replay coming soon">
        You will be able to play this Session back with the transcript highlighted.
      </EmptyState>
    </>
  );
}
