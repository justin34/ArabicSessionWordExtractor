import type { Utterance } from './bridge';

/** What Replay highlights: an Utterance by index, and the Token in it by position. */
export interface ReplayPosition {
  utterance: number;
  /** Null before the Utterance's first word starts. */
  token: number | null;
}

/**
 * What is being heard at a playback position in the Desktop Track. The current Utterance
 * is the one whose span holds the position; the current Token is the last of its words to
 * have started, so a pause between two words keeps the earlier one lit. Between
 * Utterances nothing is highlighted.
 */
export function replayPosition(transcript: Utterance[], ms: number): ReplayPosition | null {
  const utterance = transcript.findLastIndex((u) => u.startMs <= ms && ms < u.endMs);
  if (utterance === -1) return null;
  const token = transcript[utterance].tokens.findLastIndex((t) => t.startMs <= ms);
  return { utterance, token: token === -1 ? null : token };
}
