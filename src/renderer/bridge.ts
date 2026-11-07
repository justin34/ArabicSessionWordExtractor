import type {
  AudioDevice,
  AudioSettings,
  LiveUtterance,
  Session,
  SessionGuide,
  Utterance,
  VocabularyEntry,
  WordCard,
  WordDetails,
} from '../core/types';

export type { AudioDevice, AudioSettings, LiveUtterance, SessionGuide, Utterance, VocabularyEntry, WordCard, WordDetails };

export type Unsubscribe = () => void;

/**
 * The renderer's whole view of the outside world. The real implementation wraps the
 * preload bridge; tests substitute a fake.
 */
export interface Bridge {
  /** With `mic`, the Session also records a Mic Track. */
  startSession(options?: { mic: boolean }): Promise<Session>;
  appendDesktopAudio(sessionId: number, chunk: Uint8Array): Promise<void>;
  /** Writes to the Session's Mic Track; it is never transcribed. */
  appendMicAudio(sessionId: number, chunk: Uint8Array): Promise<void>;
  stopSession(sessionId: number): Promise<Session>;
  listSessions(): Promise<Session[]>;
  /** A Session's stored Transcript, in order. */
  transcript(sessionId: number): Promise<Utterance[]>;
  /** Where Replay loads a Session's Desktop Track from. */
  desktopTrackUrl(sessionId: number): string;
  /** Where Replay loads a Session's Mic Track from, when it has one. */
  micTrackUrl(sessionId: number): string;
  /** The whole Vocabulary, most recently first heard first. */
  listVocabulary(): Promise<VocabularyEntry[]>;
  /** The word panel's Detail Module sections for a Lemma; null when it is not in the Vocabulary. */
  wordDetails(lemmaId: number, surface?: string): Promise<WordDetails | null>;
  /** A Lemma's Word Card; null when it has none. */
  wordCard(lemmaId: number): Promise<WordCard | null>;
  /** A completed Session's Session Guide; null when it has none. */
  sessionGuide(sessionId: number): Promise<SessionGuide | null>;
  /** Which audio devices Sessions record from, as stored. */
  audioSettings(): Promise<AudioSettings>;
  saveAudioSettings(settings: AudioSettings): Promise<AudioSettings>;
  /** Live transcript for a real Session. Nothing is connected to it yet. */
  subscribeTranscript(sessionId: number, onUpdate: (u: LiveUtterance) => void): Unsubscribe;
}

/** Thrown by capture when the system offers no desktop audio. */
export class NoDesktopAudioError extends Error {
  constructor() {
    super('No desktop audio available to record.');
  }
}

/** An open audio capture (desktop or microphone) that is not recording yet. */
export interface AudioCapture {
  /** Begin recording; chunks are delivered in order. */
  begin(onChunk: (chunk: Uint8Array) => void): void;
  /** Current input level, 0 to 1. */
  level(): number;
  /** Stop, deliver any final chunk, and release the capture. */
  stop(): Promise<void>;
}

/** Thrown by capture when the chosen device is not connected. */
export class DeviceUnavailableError extends Error {
  constructor(readonly device: AudioDevice) {
    super(`“${device.label || 'The chosen device'}” is not available. Choose another device in Settings.`);
  }
}

export interface DesktopAudioCapture {
  /**
   * Opens what is transcribed: all system audio when `source` is null, else that input
   * device. Throws NoDesktopAudioError when no desktop audio is available, and
   * DeviceUnavailableError when the device is not connected.
   */
  open(source?: AudioDevice | null): Promise<AudioCapture>;
}

/** Opens the microphone for a Session's Mic Track. Throws when it cannot be opened. */
export interface MicAudioCapture {
  /** The default microphone when `device` is null; DeviceUnavailableError when it is not connected. */
  open(device?: AudioDevice | null): Promise<AudioCapture>;
}

/** The system's audio input devices (microphones, Stereo Mix, virtual cables). */
export interface AudioInputs {
  list(): Promise<AudioDevice[]>;
}

/** Starts a scripted fake transcript for a Demo Session; returns a cancel function. */
export type DemoFeed = (onUpdate: (u: LiveUtterance) => void) => Unsubscribe;

/** A Session as the Session List shows it; Demo Sessions exist only in memory. */
export type ListedSession = Session & { isDemo?: boolean };
