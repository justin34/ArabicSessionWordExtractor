import { render } from '@testing-library/react';
import { App } from '../../src/renderer/App';
import {
  NoDesktopAudioError,
  type AudioCapture,
  type Bridge,
  type DemoFeed,
  type DesktopAudioCapture,
  type LiveUtterance,
  type MicAudioCapture,
} from '../../src/renderer/bridge';
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
  startOptions: Array<{ mic: boolean } | undefined> = [];
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
  private listeners = new Map<number, (u: LiveUtterance) => void>();
  private nextId: number;

  constructor(initial: Session[] = []) {
    this.sessions = [...initial];
    this.nextId = Math.max(0, ...initial.map((s) => s.id)) + 1;
  }

  async startSession(options?: { mic: boolean }) {
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
  onChunk: ((c: Uint8Array) => void) | null = null;

  async open(): Promise<AudioCapture> {
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
  opts: { bridge?: FakeBridge; capture?: FakeCapture; mic?: FakeCapture; demo?: ManualDemoFeed } = {},
) {
  const bridge = opts.bridge ?? new FakeBridge();
  const capture = opts.capture ?? new FakeCapture();
  const mic = opts.mic ?? new FakeCapture();
  const view = render(
    <App bridge={bridge} capture={capture} micCapture={mic} demoFeed={opts.demo?.feed} />,
  );
  return { bridge, capture, mic, ...view };
}
