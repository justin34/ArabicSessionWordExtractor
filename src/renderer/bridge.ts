import type {
  AnkiExportResult,
  AnkiExportTarget,
  ApiKeyCheck,
  ApiKeyName,
  ApiKeyStatus,
  AudioDevice,
  AudioSettings,
  BundleProblem,
  LiveUtterance,
  MicTranscriptionStatus,
  ReadyUpdate,
  ReplayLayout,
  Session,
  SessionGuide,
  Track,
  Utterance,
  VocabularyEntry,
  WordCard,
  WordDetails,
} from '../core/types';

export type { AnkiExportResult, AnkiExportTarget, ApiKeyCheck, ApiKeyName, ApiKeyStatus, AudioDevice, AudioSettings, BundleProblem, LiveUtterance, MicTranscriptionStatus, ReadyUpdate, ReplayLayout, SessionGuide, Track, Utterance, VocabularyEntry, WordCard, WordDetails };

export type Unsubscribe = () => void;

/** What a Session records and transcribes, as chosen in the Start panel and Settings. */
export interface StartOptions {
  mic: boolean;
  transcribeMic?: boolean;
  gateMic?: boolean;
}

/**
 * The renderer's whole view of the outside world. The real implementation wraps the
 * preload bridge; tests substitute a fake.
 */
export interface Bridge {
  /**
   * With `mic`, the Session also records a Mic Track; with `transcribeMic` as well, that
   * Track is transcribed as Learner Utterances, and with `gateMic` too, speech-to-text
   * hears only the gated audio sent with `appendGatedMicAudio`.
   */
  startSession(options?: StartOptions): Promise<Session>;
  appendDesktopAudio(sessionId: number, chunk: Uint8Array): Promise<void>;
  /** Writes to the Session's Mic Track; transcribed only when the Session was started so. */
  appendMicAudio(sessionId: number, chunk: Uint8Array): Promise<void>;
  /** Sends mic audio gated by the mic threshold to speech-to-text; never recorded. */
  appendGatedMicAudio(sessionId: number, chunk: Uint8Array): Promise<void>;
  stopSession(sessionId: number): Promise<Session>;
  /** Where "Transcribe my microphone" stands for a completed Session: running, or why it failed; null otherwise. */
  micTranscription(sessionId: number): Promise<MicTranscriptionStatus | null>;
  /** Starts a new copy of the Mic Track gated by the mic threshold (WAV), sent in chunks before `transcribeMicTrack`. */
  beginGatedMicRecording(sessionId: number): Promise<void>;
  appendGatedMicRecording(sessionId: number, chunk: Uint8Array): Promise<void>;
  /**
   * Transcribes a completed Session's Mic Track in the main process, in the background; with
   * `gated`, the copy sent with `appendGatedMicRecording`. Rejects when it cannot start.
   */
  transcribeMicTrack(sessionId: number, options?: { gated?: boolean }): Promise<MicTranscriptionStatus>;
  /** Told how every "Transcribe my microphone" job is going, for every Session. */
  subscribeMicTranscriptions(onStatus: (sessionId: number, status: MicTranscriptionStatus) => void): Unsubscribe;
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
  /** How Replay shows Learner Utterances, as stored for every Session. */
  replayLayout(): Promise<ReplayLayout>;
  saveReplayLayout(layout: ReplayLayout): Promise<ReplayLayout>;
  /** Whether each API key is set, and where from; never the keys themselves. */
  apiKeys(): Promise<ApiKeyStatus[]>;
  /** Stores a key entered in Settings, or removes it with null; rejects one that cannot be a key. */
  saveApiKey(name: ApiKeyName, key: string | null): Promise<ApiKeyStatus[]>;
  /** Tries the key in use against its service. */
  checkApiKey(name: ApiKeyName): Promise<ApiKeyCheck>;
  /** The dictionary build's attribution notice; null when there is no dictionary. */
  dictionaryNotice(): Promise<string | null>;
  /**
   * Asks where to save, then writes an Anki deck of the target's words; null when the
   * learner cancels. Rejects, leaving no file, when the deck cannot be written.
   */
  exportToAnki(target: AnkiExportTarget): Promise<AnkiExportResult | null>;
  /** Shows an exported deck in the system's file manager. */
  showExportedFile(path: string): Promise<void>;
  /** Bundled parts a packaged build is missing or cannot open; empty when all work. */
  bundleProblems(): Promise<BundleProblem[]>;
  /** The update downloaded in the background; null until there is one. */
  readyUpdate(): Promise<ReadyUpdate | null>;
  /** Told when an update has downloaded. */
  subscribeUpdateReady(onReady: (update: ReadyUpdate) => void): Unsubscribe;
  /** Quits and installs the ready update; rejects while a Session is recording. */
  restartToUpdate(): Promise<void>;
  /** Live transcript for a real Session. */
  subscribeTranscript(sessionId: number, onUpdate: (u: LiveUtterance) => void): Unsubscribe;
  /** Why a live Session's speech-to-text has stopped on a Track (the Desktop Track by default); null while it works. */
  transcriptionFailure(sessionId: number, track?: Track): Promise<string | null>;
  /** Told when a live Session's speech-to-text stops on a Track; its audio keeps recording. */
  subscribeTranscriptionFailure(
    sessionId: number,
    onFailure: (message: string, track: Track) => void,
  ): Unsubscribe;
}

/** Thrown by capture when the system offers no desktop audio. */
export class NoDesktopAudioError extends Error {
  constructor() {
    super('No desktop audio available to record.');
  }
}

/** An open audio capture (desktop or microphone) that is not recording yet. */
export interface AudioCapture {
  /**
   * Begin recording; chunks are delivered in order. A microphone opened with a threshold
   * also records the gated audio, on the same timeline, for `onGatedChunk`.
   */
  begin(onChunk: (chunk: Uint8Array) => void, onGatedChunk?: (chunk: Uint8Array) => void): void;
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
  /**
   * The default microphone when `device` is null; DeviceUnavailableError when it is not
   * connected. With a `threshold`, it also records a gated copy for speech-to-text: audio
   * below the threshold silenced, held open briefly after the level falls (see micGate).
   */
  open(device?: AudioDevice | null, threshold?: number): Promise<AudioCapture>;
}

/**
 * Applies the mic threshold to a stored Mic Track: decodes it and returns it as WAV, with
 * what the gate shuts out silenced, on the same timeline, in chunks.
 */
export interface MicRecordingGate {
  gate(url: string, threshold: number): Promise<Uint8Array[]>;
}

/** The system's audio input devices (microphones, Stereo Mix, virtual cables). */
export interface AudioInputs {
  list(): Promise<AudioDevice[]>;
}

/** Starts a scripted fake transcript for a Demo Session; returns a cancel function. */
export type DemoFeed = (onUpdate: (u: LiveUtterance) => void) => Unsubscribe;

/** A Session as the Session List shows it; Demo Sessions exist only in memory. */
export type ListedSession = Session & { isDemo?: boolean };
