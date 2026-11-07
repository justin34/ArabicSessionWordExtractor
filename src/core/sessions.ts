import { appendFileSync, createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { AudioChannel } from './audioChannel';
import type { Providers } from './providers';
import type { Store } from './store';
import type { LiveUtterance, Session, Token, TranscriptListener, Utterance } from './types';

interface LiveSession {
  desktopTrackPath: string;
  audio: AudioChannel;
  /** False once speech-to-text has failed; audio then goes to the Desktop Track only. */
  transcribing: boolean;
  /** Settles when the provider pipeline has drained. Never rejects. */
  transcribed: Promise<void>;
  /** Sentence translations still in flight. Each settles, never rejects. */
  translations: Set<Promise<void>>;
}

/**
 * The Session pipeline. Desktop audio streamed into a live Session is written to its
 * Desktop Track and, at the same time, fed to speech-to-text; each final Utterance is
 * stored in the Session's Transcript and shown at once, then translated alongside.
 */
export class Sessions {
  private readonly live = new Map<number, LiveSession>();
  private readonly listeners = new Set<TranscriptListener>();

  constructor(
    private readonly store: Store,
    private readonly providers: Providers,
    private readonly recordingsDir: string,
  ) {
    mkdirSync(recordingsDir, { recursive: true });
    // No Session can still be live when the app opens; any left recording died with the app.
    store.completeAbandonedSessions(new Date().toISOString());
  }

  /** Begins a live Session. `extension` is the Desktop Track's audio file type. */
  start(extension = 'webm'): Session {
    const session = this.store.createSession(new Date().toISOString(), (id) =>
      join(this.recordingsDir, `session-${id}-desktop.${extension}`),
    );
    writeFileSync(session.desktopTrackPath, new Uint8Array());
    const live: LiveSession = {
      desktopTrackPath: session.desktopTrackPath,
      audio: new AudioChannel(),
      transcribing: true,
      transcribed: Promise.resolve(),
      translations: new Set(),
    };
    this.live.set(session.id, live);
    live.transcribed = this.transcribe(session.id, live);
    return session;
  }

  appendDesktopAudio(sessionId: number, chunk: Uint8Array): void {
    const live = this.live.get(sessionId);
    if (!live) throw new Error(`Session ${sessionId} is not recording`);
    appendFileSync(live.desktopTrackPath, chunk);
    if (live.transcribing) live.audio.push(chunk);
  }

  /** Ends the recording, waits for the Transcript to be finished, and completes the Session. */
  async stop(sessionId: number): Promise<Session> {
    const live = this.live.get(sessionId);
    if (!live) return this.store.getSession(sessionId);
    this.live.delete(sessionId);
    live.audio.close();
    await live.transcribed;
    // Translations started by the last Utterances finish before the Session completes.
    while (live.translations.size > 0) await Promise.all(live.translations);
    return this.store.completeSession(sessionId, new Date().toISOString());
  }

  /** Stops every live Session, e.g. when the app quits. */
  async stopAll(): Promise<void> {
    await Promise.all([...this.live.keys()].map((id) => this.stop(id)));
  }

  /** Runs a recorded audio file through the same path as a live Session. */
  async processRecording(audioPath: string): Promise<Session> {
    const { id } = this.start(extname(audioPath).slice(1) || 'webm');
    try {
      for await (const chunk of createReadStream(audioPath)) {
        this.appendDesktopAudio(id, chunk as Uint8Array);
      }
    } finally {
      await this.stop(id);
    }
    return this.store.getSession(id);
  }

  /** Receives every live Transcript update, for every recording Session. */
  subscribe(listener: TranscriptListener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  list(): Session[] {
    return this.store.listSessions();
  }

  transcript(sessionId: number): Utterance[] {
    return this.store.getTranscript(sessionId);
  }

  private emit(sessionId: number, update: LiveUtterance): void {
    for (const listener of this.listeners) {
      try {
        listener(sessionId, update);
      } catch (err) {
        console.error('Transcript listener failed:', err);
      }
    }
  }

  private async transcribe(sessionId: number, live: LiveSession): Promise<void> {
    // Interim text and the final Utterance it becomes share one live id.
    let utteranceIndex = 0;
    try {
      for await (const event of this.providers.speechToText.transcribe(live.audio)) {
        const id = String(utteranceIndex);
        if (event.type === 'interim') {
          this.emit(sessionId, { id, isFinal: false, text: event.text, translation: '', tokens: [] });
          continue;
        }
        utteranceIndex++;
        // Glosses and Lemmas attach once Arabic analysis is wired in.
        const tokens: Token[] = (event.words ?? []).map((w) => ({
          surface: w.text,
          startMs: w.startMs,
          endMs: w.endMs,
          gloss: '',
          lemmaId: null,
        }));
        const final: LiveUtterance = { id, isFinal: true, text: event.text, translation: '', tokens };
        const utteranceId = this.store.addUtterance({
          sessionId,
          text: event.text,
          translation: '',
          startMs: event.startMs,
          endMs: event.endMs,
          tokens,
        });
        this.emit(sessionId, final);
        // Translating does not hold up the next Utterance's speech-to-text.
        const translating = this.translate(sessionId, utteranceId, final).finally(() =>
          live.translations.delete(translating),
        );
        live.translations.add(translating);
      }
    } catch (err) {
      // The Desktop Track is written independently; a provider failure must never lose audio.
      console.error(`Transcription failed for Session ${sessionId}:`, err);
    } finally {
      // Nothing reads the channel any more, so stop queueing audio into it.
      live.transcribing = false;
    }
  }

  /** Adds the sentence translation to a final Utterance. A failure leaves it untranslated. */
  private async translate(sessionId: number, utteranceId: number, final: LiveUtterance): Promise<void> {
    try {
      const translation = await this.providers.translator.translate(final.text);
      if (!translation) return;
      this.store.setTranslation(utteranceId, translation);
      this.emit(sessionId, { ...final, translation });
    } catch (err) {
      console.error(`Translation failed for an Utterance in Session ${sessionId}:`, err);
      // The Arabic stays as it is; Live View warns that translation is not working.
      this.emit(sessionId, { ...final, translationError: (err as Error).message || String(err) });
    }
  }
}
