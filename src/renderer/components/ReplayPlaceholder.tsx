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
      <EmptyState title="Nothing to replay">
        A Demo Session is never stored, so it has no audio or Transcript to play back.
      </EmptyState>
    </>
  );
}
