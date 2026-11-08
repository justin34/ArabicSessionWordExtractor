import { appendFileSync, existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasArabicWord } from './analysis/align';
import type { RecordedAudio, RecordedSpeechToText, Translator } from './providers';
import type { Store } from './store';
import { segmentWords } from './stt/recorded';
import type { MicTranscriptionListener, MicTranscriptionStatus, Session } from './types';

export const NO_RECORDED_TRANSCRIPTION = 'Transcribing a recording is not available in this build.';

const NOTES = {
  transcribing: 'Transcribing your speech… you can leave this screen.',
  translating: 'Translating your speech…',
};

/**
 * "Transcribe my microphone" (GLOSSARY: Learner Utterance): a completed Session that has
 * a Mic Track but no Learner Utterances, recorded before they existed or without "Also
 * transcribe my speech", has its Mic Track transcribed afterwards, in the background.
 * Like live ones, the resulting Learner Utterances are translated, never analyzed (ADR
 * 0004). It runs once per Session; a failure says why and may be tried again. Nothing is
 * kept of a job the app quits during, so it can simply be started again.
 */
export class MicTranscriptions {
  private readonly running = new Map<number, Promise<void>>();
  /** Why the last try failed, until the next one. */
  private readonly failures = new Map<number, string>();
  private readonly listeners = new Set<MicTranscriptionListener>();

  constructor(
    private readonly store: Store,
    private readonly providers: { recordedSpeechToText?: RecordedSpeechToText; translator: Translator },
    private readonly recordingsDir: string,
  ) {}

  /** Where the renderer puts the Mic Track gated by the mic threshold, as WAV, before it is sent. */
  private gatedPath(sessionId: number): string {
    return join(this.recordingsDir, `session-${sessionId}-mic-gated.wav`);
  }

  /**
   * Why the Session cannot be transcribed now; undefined when it can: completed, with a
   * recorded Mic Track, no Learner Utterances, and no job already running.
   */
  refusal(sessionId: number): string | undefined {
    let session: Session;
    try {
      session = this.store.getSession(sessionId);
    } catch {
      return 'There is no such Session.';
    }
    if (session.status !== 'completed') return 'The Session is still recording.';
    if (!session.micTrackPath || !existsSync(session.micTrackPath) || statSync(session.micTrackPath).size === 0) {
      return 'The Session has no recorded microphone.';
    }
    if (this.running.has(sessionId)) return 'Your speech is already being transcribed.';
    if (this.store.getTranscript(sessionId).some((u) => u.track === 'mic')) {
      return 'Your speech in this Session is already transcribed.';
    }
    return undefined;
  }

  /** Starts a new gated copy of the Mic Track (WAV), replacing any left from before. */
  beginGatedAudio(sessionId: number): void {
    const refused = this.refusal(sessionId);
    if (refused) throw new Error(refused);
    writeFileSync(this.gatedPath(sessionId), new Uint8Array());
  }

  appendGatedAudio(sessionId: number, chunk: Uint8Array): void {
    if (this.running.has(sessionId)) throw new Error('Your speech is already being transcribed.');
    const path = this.gatedPath(sessionId);
    if (!existsSync(path)) throw new Error('Begin the gated audio first.');
    appendFileSync(path, chunk);
  }

  /**
   * Starts transcribing the Session's Mic Track in the background; with `gated`, the copy
   * the mic threshold gated (sent with `appendGatedAudio`) is what speech-to-text hears.
   * Throws when the Session cannot be transcribed.
   */
  start(sessionId: number, { gated = false }: { gated?: boolean } = {}): MicTranscriptionStatus {
    const refused = this.refusal(sessionId);
    if (refused) throw new Error(refused);
    const session = this.store.getSession(sessionId);
    const audio: RecordedAudio = gated
      ? { path: this.gatedPath(sessionId), contentType: 'audio/wav' }
      : { path: session.micTrackPath!, contentType: contentTypeOf(session.micTrackPath!) };
    if (gated && (!existsSync(audio.path) || statSync(audio.path).size === 0)) {
      throw new Error('The gated audio was not sent.');
    }
    this.failures.delete(sessionId);
    this.notes.set(sessionId, NOTES.transcribing);
    // Begun on the next tick, so it is running (and told so) before any of it happens.
    const job = Promise.resolve()
      .then(() => this.run(sessionId, audio))
      .finally(() => {
        this.running.delete(sessionId);
        if (gated) rmSync(audio.path, { force: true });
      });
    this.running.set(sessionId, job);
    return this.status(sessionId)!;
  }

  /** Where a Session's transcription stands: running, or why it last failed; null otherwise. */
  status(sessionId: number): MicTranscriptionStatus | null {
    if (this.running.has(sessionId)) return { state: 'running', note: this.notes.get(sessionId) ?? NOTES.transcribing };
    const message = this.failures.get(sessionId);
    return message ? { state: 'failed', message } : null;
  }

  subscribe(listener: MicTranscriptionListener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Settles once every running job has finished; for tests and shutdown. */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.all(this.running.values());
  }

  private readonly notes = new Map<number, string>();

  private tell(sessionId: number, status: MicTranscriptionStatus): void {
    if (status.state === 'running') this.notes.set(sessionId, status.note);
    else this.notes.delete(sessionId);
    for (const listener of this.listeners) {
      try {
        listener(sessionId, status);
      } catch (err) {
        console.error('Mic transcription listener failed:', err);
      }
    }
  }

  private async run(sessionId: number, audio: RecordedAudio): Promise<void> {
    try {
      this.tell(sessionId, { state: 'running', note: NOTES.transcribing });
      const stt = this.providers.recordedSpeechToText;
      if (!stt) throw new Error(NO_RECORDED_TRANSCRIPTION);
      const utterances = segmentWords(await stt.transcribeFile(audio));
      this.tell(sessionId, { state: 'running', note: NOTES.translating });
      // Translated first and stored together, so a quit part way stores nothing.
      const translations: string[] = [];
      for (const u of utterances) translations.push(await this.translate(sessionId, u.text));
      utterances.forEach((u, i) =>
        this.store.addUtterance({
          sessionId,
          text: u.text,
          translation: translations[i],
          startMs: u.startMs,
          endMs: u.endMs,
          // Never analyzed: no Lemma, no gloss (ADR 0004).
          tokens: (u.words ?? []).map((w) => ({ surface: w.text, startMs: w.startMs, endMs: w.endMs, gloss: '', lemmaId: null })),
          track: 'mic',
        }),
      );
      this.running.delete(sessionId);
      this.tell(sessionId, { state: 'done' });
    } catch (err) {
      console.error(`Transcribing the Mic Track of Session ${sessionId} failed:`, err);
      const message = (err as Error).message || String(err);
      this.failures.set(sessionId, message);
      this.running.delete(sessionId);
      this.tell(sessionId, { state: 'failed', message });
    }
  }

  /** The sentence translation; '' for no Arabic, or when translation fails (the Arabic stays). */
  private async translate(sessionId: number, text: string): Promise<string> {
    if (!hasArabicWord(text)) return '';
    try {
      return await this.providers.translator.translate(text);
    } catch (err) {
      console.error(`Translation failed for a Learner Utterance in Session ${sessionId}:`, err);
      return '';
    }
  }
}

function contentTypeOf(path: string): string {
  if (path.endsWith('.wav')) return 'audio/wav';
  if (path.endsWith('.ogg') || path.endsWith('.opus')) return 'audio/ogg';
  return 'audio/webm';
}
