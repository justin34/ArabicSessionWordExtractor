import type { Session, Token } from '../core/types';

/** A transcript update streamed to Live View. Re-sending the same id replaces that Utterance. */
export interface LiveUtterance {
  id: string;
  isFinal: boolean;
  /** Arabic text (all the learner sees while interim). */
  text: string;
  /** Sentence translation; empty while interim. */
  translation: string;
  /** Word columns with glosses; empty while interim. */
  tokens: Token[];
}

export type Unsubscribe = () => void;

/**
 * The renderer's whole view of the outside world. The real implementation wraps the
 * preload bridge; tests substitute a fake.
 */
export interface Bridge {
  startSession(): Promise<Session>;
  appendAudio(sessionId: number, chunk: Uint8Array): Promise<void>;
  stopSession(sessionId: number): Promise<Session>;
  listSessions(): Promise<Session[]>;
  /** Live transcript for a real Session. Nothing is connected to it yet. */
  subscribeTranscript(sessionId: number, onUpdate: (u: LiveUtterance) => void): Unsubscribe;
}

/** Thrown by capture when the system offers no desktop audio. */
export class NoDesktopAudioError extends Error {
  constructor() {
    super('No desktop audio available to record.');
  }
}

/** An open desktop-audio capture that is not recording yet. */
export interface AudioCapture {
  /** Begin recording; chunks are delivered in order. */
  begin(onChunk: (chunk: Uint8Array) => void): void;
  /** Current input level, 0 to 1. */
  level(): number;
  /** Stop, deliver any final chunk, and release the capture. */
  stop(): Promise<void>;
}

export interface DesktopAudioCapture {
  /** Throws NoDesktopAudioError when no desktop audio is available. */
  open(): Promise<AudioCapture>;
}

/** Starts a scripted fake transcript for a Demo Session; returns a cancel function. */
export type DemoFeed = (onUpdate: (u: LiveUtterance) => void) => Unsubscribe;

/** A Session as the Session List shows it; Demo Sessions exist only in memory. */
export type ListedSession = Session & { isDemo?: boolean };
