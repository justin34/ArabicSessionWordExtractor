import type { LiveUtterance, Session, SessionGuide, VocabularyEntry, WordCard, WordDetails } from '../core/types';

export type { LiveUtterance, SessionGuide, VocabularyEntry, WordCard, WordDetails };

export type Unsubscribe = () => void;

/**
 * The renderer's whole view of the outside world. The real implementation wraps the
 * preload bridge; tests substitute a fake.
 */
export interface Bridge {
  startSession(): Promise<Session>;
  appendDesktopAudio(sessionId: number, chunk: Uint8Array): Promise<void>;
  stopSession(sessionId: number): Promise<Session>;
  listSessions(): Promise<Session[]>;
  /** The whole Vocabulary, most recently first heard first. */
  listVocabulary(): Promise<VocabularyEntry[]>;
  /** The word panel's Detail Module sections for a Lemma; null when it is not in the Vocabulary. */
  wordDetails(lemmaId: number, surface?: string): Promise<WordDetails | null>;
  /** A Lemma's Word Card; null when it has none. */
  wordCard(lemmaId: number): Promise<WordCard | null>;
  /** A completed Session's Session Guide; null when it has none. */
  sessionGuide(sessionId: number): Promise<SessionGuide | null>;
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
