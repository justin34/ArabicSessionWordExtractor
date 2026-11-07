import { appendFileSync, copyFileSync, createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Providers } from './providers';
import type { Store } from './store';
import type { Session, Utterance } from './types';

/** The Session pipeline: records the Desktop Track and turns audio into a stored Transcript. */
export class SessionService {
  constructor(
    private readonly store: Store,
    private readonly providers: Providers,
    private readonly recordingsDir: string,
  ) {
    mkdirSync(recordingsDir, { recursive: true });
  }

  /** Begin a live Session. Audio is appended with appendDesktopAudio. */
  start(extension = 'webm'): Session {
    const startedAt = new Date().toISOString();
    const session = this.store.createSession(startedAt, '');
    const path = join(this.recordingsDir, `session-${session.id}-desktop.${extension}`);
    writeFileSync(path, new Uint8Array());
    this.store.setDesktopTrackPath(session.id, path);
    return this.store.getSession(session.id);
  }

  appendDesktopAudio(sessionId: number, chunk: Uint8Array): void {
    const session = this.store.getSession(sessionId);
    if (session.status !== 'recording') {
      throw new Error(`Session ${sessionId} is not recording`);
    }
    appendFileSync(session.desktopTrackPath, chunk);
  }

  stop(sessionId: number): Session {
    const session = this.store.getSession(sessionId);
    if (session.status !== 'recording') return session;
    return this.store.completeSession(sessionId, new Date().toISOString());
  }

  list(): Session[] {
    return this.store.listSessions();
  }

  getTranscript(sessionId: number): Utterance[] {
    return this.store.getTranscript(sessionId);
  }

  /**
   * Run a recorded audio file through the whole pipeline: save it as the Desktop Track,
   * transcribe, translate each final sentence, and store the Transcript.
   */
  async processRecording(audioPath: string): Promise<number> {
    const extension = extname(audioPath).slice(1) || 'webm';
    const session = this.start(extension);
    copyFileSync(audioPath, session.desktopTrackPath);

    const audio = createReadStream(audioPath) as AsyncIterable<Uint8Array>;
    for await (const event of this.providers.speechToText.transcribe(audio)) {
      if (event.type !== 'final') continue;
      const translation = await this.providers.translator.translate(event.text);
      this.store.addUtterance({
        sessionId: session.id,
        text: event.text,
        translation,
        startMs: event.startMs,
        endMs: event.endMs,
      });
    }
    this.stop(session.id);
    return session.id;
  }
}
