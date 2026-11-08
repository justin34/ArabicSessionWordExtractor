import { render } from '@testing-library/react';
import { App } from '../../src/renderer/App';
import {
  DeviceUnavailableError,
  type AnkiExportResult,
  type AnkiExportTarget,
  type ApiKeyCheck,
  type ApiKeyName,
  type ApiKeyStatus,
  NoDesktopAudioError,
  type AudioCapture,
  type AudioDevice,
  type AudioInputs,
  type AudioSettings,
  type Bridge,
  type DemoFeed,
  type DesktopAudioCapture,
  type LiveUtterance,
  type MicAudioCapture,
  type Track,
} from '../../src/renderer/bridge';
import type { BundleProblem, ReadyUpdate } from '../../src/core/types';
import type { Session, SessionGuide, Utterance, VocabularyEntry, WordCard, WordDetails } from '../../src/core/types';

export function session(over: Partial<Session> & { id: number }): Session {
  return {
    startedAt: '2026-01-01T10:00:00.000Z',
    endedAt: '2026-01-01T10:05:00.000Z',
    status: 'completed',
    desktopTrackPath: '',
    micTrackPath: null,
    ...over,
  };
}

/** Fake of the preload bridge: keeps Sessions in memory and records calls. */
export class FakeBridge implements Bridge {
  sessions: Session[];
  calls: string[] = [];
  chunks: Array<{ sessionId: number; chunk: Uint8Array }> = [];
  micChunks: Array<{ sessionId: number; chunk: Uint8Array }> = [];
  /** The options each startSession call was given, in order. */
  startOptions: Array<{ mic: boolean; transcribeMic?: boolean } | undefined> = [];
  appendError: Error | null = null;
  vocabulary: VocabularyEntry[] = [];
  /** Word panel content by Lemma id. */
  details = new Map<number, WordDetails>();
  detailsError: Error | null = null;
  detailRequests: Array<{ lemmaId: number; surface?: string }> = [];
  /** Word Cards by Lemma id, Session Guides by Session id. */
  wordCards = new Map<number, WordCard>();
  sessionGuides = new Map<number, SessionGuide>();
  guideError: Error | null = null;
  /** Stored Transcripts by Session id. */
  transcripts = new Map<number, Utterance[]>();
  transcriptError: Error | null = null;
  /** Stored audio settings; each save is recorded. */
  audio: AudioSettings = { desktopSource: null, microphone: null };
  savedAudio: AudioSettings[] = [];
  saveAudioError: Error | null = null;
  /** Stored API keys by name (the fake keeps them; the real bridge never returns them). */
  keys = new Map<ApiKeyName, string>();
  /** Keys set only by the environment. */
  envKeys = new Map<ApiKeyName, string>();
  savedKeys: Array<{ name: ApiKeyName; key: string | null }> = [];
  saveKeyError: Error | null = null;
  /** The outcome of checking each key; a key with none set is missing. */
  keyChecks = new Map<ApiKeyName, ApiKeyCheck>();
  checkedKeys: ApiKeyName[] = [];
  apiKeysError: Error | null = null;
  notice: string | null = null;
  /** Each export asked for; the Save dialog's answer is `exportResult` (null: cancelled). */
  exports: AnkiExportTarget[] = [];
  exportResult: AnkiExportResult | null = { count: 3, path: String.raw`C:\Users\me\Documents\arabic-vocabulary-2026-11-07.apkg` };
  exportError: Error | null = null;
  shownFiles: string[] = [];
  /** Why each Session's speech-to-text stopped, as the main process would say; the Mic Track's in `micFailures`. */
  failures = new Map<number, string>();
  micFailures = new Map<number, string>();
  /** Bundled parts the packaged build is missing, as the main process would say. */
  problems: BundleProblem[] = [];
  /** The update downloaded before the window opened, if any. */
  update: ReadyUpdate | null = null;
  restarts = 0;
  restartError: Error | null = null;
  private updateListeners = new Set<(update: ReadyUpdate) => void>();
  private listeners = new Map<number, (u: LiveUtterance) => void>();
  private failureListeners = new Map<number, (message: string, track: Track) => void>();
  private nextId: number;

  constructor(initial: Session[] = []) {
    this.sessions = [...initial];
    this.nextId = Math.max(0, ...initial.map((s) => s.id)) + 1;
  }

  async startSession(options?: { mic: boolean; transcribeMic?: boolean }) {
    this.startOptions.push(options);
    const id = this.nextId++;
    const s = session({
      id,
      status: 'recording',
      endedAt: null,
      startedAt: new Date().toISOString(),
      micTrackPath: options?.mic ? `session-${id}-mic.webm` : null,
    });
    this.sessions.unshift(s);
    this.calls.push(`start:${s.id}`);
    return s;
  }
  async appendDesktopAudio(sessionId: number, chunk: Uint8Array) {
    if (this.appendError) throw this.appendError;
    this.chunks.push({ sessionId, chunk });
  }
  async appendMicAudio(sessionId: number, chunk: Uint8Array) {
    if (this.appendError) throw this.appendError;
    this.micChunks.push({ sessionId, chunk });
  }
  async stopSession(sessionId: number) {
    this.calls.push(`stop:${sessionId}`);
    const i = this.sessions.findIndex((s) => s.id === sessionId);
    this.sessions[i] = { ...this.sessions[i], status: 'completed', endedAt: new Date().toISOString() };
    return this.sessions[i];
  }
  async listSessions() {
    return [...this.sessions].sort((a, b) => b.id - a.id);
  }
  async transcript(sessionId: number) {
    this.calls.push(`transcript:${sessionId}`);
    if (this.transcriptError) throw this.transcriptError;
    return this.transcripts.get(sessionId) ?? [];
  }
  desktopTrackUrl(sessionId: number) {
    return `session-audio://desktop/${sessionId}`;
  }
  micTrackUrl(sessionId: number) {
    return `session-audio://mic/${sessionId}`;
  }
  async listVocabulary() {
    return [...this.vocabulary];
  }
  async wordDetails(lemmaId: number, surface?: string) {
    this.detailRequests.push({ lemmaId, surface });
    if (this.detailsError) throw this.detailsError;
    return this.details.get(lemmaId) ?? null;
  }
  async wordCard(lemmaId: number) {
    this.calls.push(`wordCard:${lemmaId}`);
    return this.wordCards.get(lemmaId) ?? null;
  }
  async sessionGuide(sessionId: number) {
    this.calls.push(`sessionGuide:${sessionId}`);
    if (this.guideError) throw this.guideError;
    return this.sessionGuides.get(sessionId) ?? null;
  }
  async audioSettings() {
    return this.audio;
  }
  async saveAudioSettings(settings: AudioSettings) {
    if (this.saveAudioError) throw this.saveAudioError;
    this.savedAudio.push(settings);
    this.audio = settings;
    return settings;
  }
  async apiKeys(): Promise<ApiKeyStatus[]> {
    if (this.apiKeysError) throw this.apiKeysError;
    return (['soniox', 'deepgram', 'googleTranslate'] as const).map((name) => {
      const key = this.keys.get(name) ?? this.envKeys.get(name);
      return {
        name,
        source: key === undefined ? null : this.keys.has(name) ? 'settings' : 'environment',
        hint: key === undefined ? null : key.slice(-4),
      };
    });
  }
  async saveApiKey(name: ApiKeyName, key: string | null) {
    if (this.saveKeyError) throw this.saveKeyError;
    this.savedKeys.push({ name, key });
    // Trimmed, as the main process stores it.
    if (key === null || key.trim() === '') this.keys.delete(name);
    else this.keys.set(name, key.trim());
    return this.apiKeys();
  }
  async checkApiKey(name: ApiKeyName): Promise<ApiKeyCheck> {
    this.checkedKeys.push(name);
    return this.keyChecks.get(name) ?? { ok: true, message: 'The service accepted the key.' };
  }
  async exportToAnki(target: AnkiExportTarget) {
    this.exports.push(target);
    if (this.exportError) throw this.exportError;
    return this.exportResult;
  }
  async showExportedFile(path: string) {
    this.shownFiles.push(path);
  }
  async dictionaryNotice() {
    return this.notice;
  }
  async bundleProblems() {
    return this.problems;
  }
  async readyUpdate() {
    return this.update;
  }
  subscribeUpdateReady(onReady: (update: ReadyUpdate) => void) {
    this.updateListeners.add(onReady);
    return () => void this.updateListeners.delete(onReady);
  }
  /** Plays the main process telling the renderer an update has downloaded. */
  downloadUpdate(version: string) {
    this.update = { version };
    for (const l of this.updateListeners) l(this.update);
  }
  async restartToUpdate() {
    if (this.restartError) throw this.restartError;
    this.restarts++;
  }
  async transcriptionFailure(sessionId: number, track: Track = 'desktop') {
    return (track === 'mic' ? this.micFailures : this.failures).get(sessionId) ?? null;
  }
  subscribeTranscriptionFailure(sessionId: number, onFailure: (message: string, track: Track) => void) {
    this.failureListeners.set(sessionId, onFailure);
    return () => void this.failureListeners.delete(sessionId);
  }
  /** Plays the main process telling the renderer a Session's speech-to-text stopped on a Track. */
  failTranscription(sessionId: number, message: string, track: Track = 'desktop') {
    (track === 'mic' ? this.micFailures : this.failures).set(sessionId, message);
    this.failureListeners.get(sessionId)?.(message, track);
  }
  subscribeTranscript(sessionId: number, onUpdate: (u: LiveUtterance) => void) {
    this.listeners.set(sessionId, onUpdate);
    return () => void this.listeners.delete(sessionId);
  }
  emit(sessionId: number, u: LiveUtterance) {
    this.listeners.get(sessionId)?.(u);
  }
}

export class FakeCapture implements DesktopAudioCapture, MicAudioCapture {
  noAudio = false;
  openError: Error | null = null;
  beginError: Error | null = null;
  levelValue = 0;
  opened = 0;
  stopped = 0;
  /** The device each open asked for; null is the system's own. */
  openedWith: Array<AudioDevice | null> = [];
  /** Device ids that are not connected. */
  unplugged = new Set<string>();
  onChunk: ((c: Uint8Array) => void) | null = null;

  async open(device: AudioDevice | null = null): Promise<AudioCapture> {
    this.openedWith.push(device);
    if (device && this.unplugged.has(device.deviceId)) throw new DeviceUnavailableError(device);
    if (this.noAudio) throw new NoDesktopAudioError();
    if (this.openError) throw this.openError;
    this.opened++;
    return {
      begin: (onChunk) => {
        if (this.beginError) throw this.beginError;
        this.onChunk = onChunk;
      },
      level: () => this.levelValue,
      stop: async () => {
        this.stopped++;
      },
    };
  }
}

/** A fixed list of audio inputs. */
export class FakeAudioInputs implements AudioInputs {
  constructor(public devices: AudioDevice[] = []) {}
  listed = 0;
  async list() {
    this.listed++;
    return [...this.devices];
  }
}

/** A demo feed the test drives by hand. */
export class ManualDemoFeed {
  emit: (u: LiveUtterance) => void = () => {};
  started = 0;
  cancelled = 0;
  feed: DemoFeed = (onUpdate) => {
    this.started++;
    this.emit = onUpdate;
    return () => void this.cancelled++;
  };
}

export function renderApp(
  opts: {
    bridge?: FakeBridge;
    capture?: FakeCapture;
    mic?: FakeCapture;
    inputs?: FakeAudioInputs;
    demo?: ManualDemoFeed;
  } = {},
) {
  const bridge = opts.bridge ?? new FakeBridge();
  const capture = opts.capture ?? new FakeCapture();
  const mic = opts.mic ?? new FakeCapture();
  const inputs = opts.inputs ?? new FakeAudioInputs();
  const view = render(
    <App bridge={bridge} capture={capture} micCapture={mic} audioInputs={inputs} demoFeed={opts.demo?.feed} />,
  );
  return { bridge, capture, mic, inputs, ...view };
}
