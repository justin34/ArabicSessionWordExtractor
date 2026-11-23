/**
 * Import a recording (GLOSSARY: Imported Session): an audio or video file the learner picks
 * becomes a new completed Session. The file is copied unchanged as its Desktop Track,
 * transcribed by the recorded-audio path (Soniox async, Utterances split by
 * `segmentWords`), then each Utterance is translated and analyzed as a live Session's.
 * The job runs in the main process, one at a time. Cancel, a failure or quitting abandons
 * it: its rows and the copied file are deleted.
 */
import { existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { NO_RECORDED_TRANSCRIPTION } from './micTranscription';
import type { RecordedSpeechToText } from './providers';
import { deleteAudioFiles, normalizeSessionName } from './sessionLibrary';
import type { Sessions } from './sessions';
import type { Store } from './store';
import { segmentWords } from './stt/recorded';
import { MAX_SESSION_NAME, type ImportListener, type ImportStatus, type Session } from './types';

/** What Chromium plays (no ffmpeg in the app), by extension, with the media type sent to speech-to-text. */
export const IMPORT_FORMATS: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.webm': 'audio/webm',
  '.mp4': 'video/mp4',
};

export const UNSUPPORTED_RECORDING =
  'That file cannot be imported. Choose an mp3, m4a, aac, wav, ogg, opus, webm or mp4 file.';
export const ALREADY_IMPORTING = 'A recording is already being imported. Wait for it to finish, or cancel it.';

export const IMPORT_NOTES = {
  copying: 'Copying the recording…',
  uploading: 'Uploading…',
  transcribing: 'Transcribing…',
  translating: (n: number, of: number) => `Translating ${n} of ${of}`,
};

/** Why a file cannot be imported; undefined when it can. */
export function importRefusal(path: string): string | undefined {
  return IMPORT_FORMATS[extname(path).toLowerCase()] ? undefined : UNSUPPORTED_RECORDING;
}

/** The Session name suggested for a file: its name without the extension. */
export function suggestedName(path: string): string {
  const name = basename(path, extname(path)).trim();
  return [...name].slice(0, MAX_SESSION_NAME).join('');
}

interface Job {
  session: Session;
  /** Named in a failure notice: the Session name, else the file's. */
  label: string;
  cancelled: boolean;
  /** The Utterance being stored, translated and analyzed; Cancel waits for it. */
  step: Promise<void> | null;
}

export class RecordingImports {
  private job: Job | null = null;
  private running: Promise<void> | null = null;
  private readonly notes = new Map<number, string>();
  private readonly listeners = new Set<ImportListener>();

  constructor(
    private readonly store: Store,
    private readonly sessions: Sessions,
    private readonly providers: { recordedSpeechToText?: RecordedSpeechToText },
    private readonly recordingsDir: string,
  ) {
    // An import the app quit (or crashed) during is abandoned.
    for (const id of store.importingSessionIds()) this.discard(id);
  }

  /**
   * Starts importing `sourcePath` as a new Session named `name`, in the background, and
   * returns that Session, marked importing. `durationMs` is the recording's length when
   * known, which decides whether Deepgram may transcribe it. Throws when it cannot start.
   */
  start(sourcePath: string, name: string | null, durationMs: number | null): Session {
    if (this.job) throw new Error(ALREADY_IMPORTING);
    const refused = importRefusal(sourcePath);
    if (refused) throw new Error(refused);
    if (!existsSync(sourcePath)) throw new Error('The file is no longer there.');
    const stored = normalizeSessionName(name);
    const extension = extname(sourcePath).toLowerCase();
    const session = this.store.createSession(
      new Date().toISOString(),
      (id) => join(this.recordingsDir, `session-${id}-desktop${extension}`),
      undefined,
      { status: 'importing', name: stored, imported: true },
    );
    const job: Job = { session, label: stored ?? basename(sourcePath), cancelled: false, step: null };
    this.job = job;
    // Begun on the next tick, so the Session is listed (and its note known) before any of it happens.
    this.running = Promise.resolve()
      .then(() => this.run(job, sourcePath, IMPORT_FORMATS[extension], durationMs))
      .finally(() => {
        if (this.job === job) this.job = null;
        this.notes.delete(session.id);
      });
    return session;
  }

  /** Where a Session's import stands; null when it is not being imported. */
  status(sessionId: number): ImportStatus | null {
    if (this.job?.session.id !== sessionId || this.job.cancelled) return null;
    return { state: 'running', note: this.notes.get(sessionId) ?? IMPORT_NOTES.copying };
  }

  subscribe(listener: ImportListener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /**
   * Abandons the Session's import: once the Utterance in hand is done, its rows and the
   * copied file are deleted. Does nothing once the import has finished.
   */
  async cancel(sessionId: number): Promise<void> {
    const job = this.job;
    if (!job || job.session.id !== sessionId || job.cancelled) return;
    job.cancelled = true;
    await job.step;
    this.discard(sessionId);
    this.tell(sessionId, { state: 'cancelled' });
  }

  /** Abandons the import running, e.g. when the app quits. */
  async abandon(): Promise<void> {
    if (this.job) await this.cancel(this.job.session.id);
  }

  /** Settles once no import is running; for tests and shutdown. */
  async idle(): Promise<void> {
    while (this.running) {
      const running = this.running;
      await running;
      if (this.running === running) this.running = null;
    }
  }

  private async run(job: Job, sourcePath: string, contentType: string, durationMs: number | null): Promise<void> {
    const { id, startedAt, desktopTrackPath } = job.session;
    try {
      this.note(job, IMPORT_NOTES.copying);
      await copyFile(sourcePath, desktopTrackPath);
      if (job.cancelled) return;
      const stt = this.providers.recordedSpeechToText;
      if (!stt) throw new Error(NO_RECORDED_TRANSCRIPTION);
      this.note(job, IMPORT_NOTES.uploading);
      const words = await stt.transcribeFile(
        { path: desktopTrackPath, contentType, importedDurationMs: durationMs },
        (phase) => this.note(job, phase === 'uploading' ? IMPORT_NOTES.uploading : IMPORT_NOTES.transcribing),
      );
      const utterances = segmentWords(words);
      // Dated at import time: each Utterance is heard at that time plus its offset in the file.
      const start = Date.parse(startedAt);
      for (const [i, u] of utterances.entries()) {
        if (job.cancelled) return;
        this.note(job, IMPORT_NOTES.translating(i + 1, utterances.length));
        job.step = this.sessions.addRecordedUtterance(id, u, new Date(start + u.startMs).toISOString());
        await job.step;
        job.step = null;
      }
      if (job.cancelled) return;
      const lengthMs = Math.max(durationMs ?? 0, utterances.at(-1)?.endMs ?? 0);
      job.step = this.sessions.completeImported(id, new Date(start + lengthMs).toISOString()).then(() => undefined);
      this.job = null;
      await job.step;
      this.tell(id, { state: 'done' });
    } catch (err) {
      if (job.cancelled) return;
      console.error(`Importing a recording as Session ${id} failed:`, err);
      job.cancelled = true;
      this.discard(id);
      this.tell(id, { state: 'failed', message: (err as Error).message || String(err), name: job.label });
    } finally {
      // Cancelled while the file was still being copied or sent: it is deleted once it is let go.
      if (job.cancelled) deleteAudioFiles({ desktopTrackPath, micTrackPath: null });
    }
  }

  /** Deletes an abandoned import's rows, then its copied file. */
  private discard(sessionId: number): void {
    try {
      const session = this.store.getSession(sessionId);
      if (session.status !== 'importing') return;
      deleteAudioFiles(this.store.purgeSession(sessionId).audio);
    } catch (err) {
      console.error(`Could not discard the import of Session ${sessionId}:`, err);
    }
  }

  private note(job: Job, note: string): void {
    if (job.cancelled || this.notes.get(job.session.id) === note) return;
    this.notes.set(job.session.id, note);
    this.tell(job.session.id, { state: 'running', note });
  }

  private tell(sessionId: number, status: ImportStatus): void {
    for (const listener of this.listeners) {
      try {
        listener(sessionId, status);
      } catch (err) {
        console.error('Import listener failed:', err);
      }
    }
  }
}
