import { appendFileSync, createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { alignToTokens, cleanSurface, hasArabicWord, isArabicWord, isWord } from './analysis/align';
import { AudioChannel } from './audioChannel';
import { quickGloss } from './dictionary/gloss';
import type { StudyGuideHooks } from './guides/studyGuides';
import type { DictionaryEntry, Providers, TokenAnalysis } from './providers';
import type { HeardWord, Store } from './store';
import type { LiveUtterance, Session, Token, TranscriptListener, Utterance } from './types';

interface LiveSession {
  desktopTrackPath: string;
  audio: AudioChannel;
  /** False once speech-to-text has failed; audio then goes to the Desktop Track only. */
  transcribing: boolean;
  /** Settles when the provider pipeline has drained. Never rejects. */
  transcribed: Promise<void>;
  /** Translations and analyses of final Utterances still in flight. Each settles, never rejects. */
  followUps: Set<Promise<void>>;
}

/** A final Utterance as last sent to Live View; its translation and analysis fill it in. */
interface FinalUtterance {
  sessionId: number;
  utteranceId: number;
  /** Wall-clock time the Utterance was final: when its words count as heard. */
  heardAt: string;
  current: LiveUtterance;
}

/**
 * The Session pipeline. Desktop audio streamed into a live Session is written to its
 * Desktop Track and, at the same time, fed to speech-to-text; each final Utterance is
 * stored in the Session's Transcript and shown at once, then translated and analyzed
 * alongside. Analysis resolves its words to Lemmas, which go into the Vocabulary.
 */
export class Sessions {
  private readonly live = new Map<number, LiveSession>();
  private readonly listeners = new Set<TranscriptListener>();

  constructor(
    private readonly store: Store,
    private readonly providers: Providers,
    private readonly recordingsDir: string,
    /** Told of Lemmas heard and Sessions ended, for Word Cards and Session Guides. */
    private readonly guides?: StudyGuideHooks,
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
      followUps: new Set(),
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

  /**
   * Ends the recording, waits for the Transcript to be finished, completes the Session
   * and generates its Session Guide.
   */
  async stop(sessionId: number): Promise<Session> {
    const live = this.live.get(sessionId);
    if (!live) return this.store.getSession(sessionId);
    this.live.delete(sessionId);
    live.audio.close();
    await live.transcribed;
    // Translations and analyses started by the last Utterances finish before the Session completes.
    while (live.followUps.size > 0) await Promise.all(live.followUps);
    const session = this.store.completeSession(sessionId, new Date().toISOString());
    await this.guides?.sessionEnded(sessionId);
    return session;
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

  /** Path of a Session's Desktop Track, for Replay; undefined for a Session that does not exist. */
  desktopTrackPath(sessionId: number): string | undefined {
    try {
      return this.store.getSession(sessionId).desktopTrackPath;
    } catch {
      return undefined;
    }
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
        // Lemmas attach once the Utterance is analyzed; glosses with the dictionary.
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
        const utterance: FinalUtterance = {
          sessionId,
          utteranceId,
          heardAt: new Date().toISOString(),
          current: final,
        };
        // An Utterance of Foreign words only stays in the Transcript, untranslated and unanalyzed.
        if (!hasArabicWord(event.text)) continue;
        // Neither holds up the next Utterance's speech-to-text.
        for (const work of [this.translate(utterance), this.analyze(utterance)]) {
          const followUp = work.finally(() => live.followUps.delete(followUp));
          live.followUps.add(followUp);
        }
      }
    } catch (err) {
      // The Desktop Track is written independently; a provider failure must never lose audio.
      console.error(`Transcription failed for Session ${sessionId}:`, err);
    } finally {
      // Nothing reads the channel any more, so stop queueing audio into it.
      live.transcribing = false;
    }
  }

  /** Sends a final Utterance again with what has filled in since. */
  private update(u: FinalUtterance, change: Partial<LiveUtterance>): void {
    u.current = { ...u.current, ...change };
    this.emit(u.sessionId, u.current);
  }

  /** Adds the sentence translation to a final Utterance. A failure leaves it untranslated. */
  private async translate(u: FinalUtterance): Promise<void> {
    try {
      const translation = await this.providers.translator.translate(u.current.text);
      if (!translation) return;
      this.store.setTranslation(u.utteranceId, translation);
      this.update(u, { translation });
    } catch (err) {
      console.error(`Translation failed for an Utterance in Session ${u.sessionId}:`, err);
      // The Arabic stays as it is; Live View warns that translation is not working.
      this.update(u, { translationError: (err as Error).message || String(err) });
    }
  }

  /**
   * Resolves a final Utterance's words to Lemmas and adds them to the Vocabulary. A
   * failure leaves its words out of the Vocabulary and its Tokens without Lemmas.
   */
  private async analyze(u: FinalUtterance): Promise<void> {
    try {
      const analyzed = (await this.providers.arabicAnalyzer.analyze(u.current.text)).filter((a) =>
        isWord(a.surface),
      );
      const tokens = u.current.tokens;
      const aligned = alignToTokens(analyzed, tokens);
      // Foreign words never enter the Vocabulary. A word is judged by the whole Token it
      // came from, so an Arabic prefix on a Latin word (الiPhone) is left out too.
      const kept = analyzed.flatMap((analysis, i) => {
        const p = aligned[i];
        const arabic = isArabicWord(analysis.surface) && (p === null || isArabicWord(tokens[p].surface));
        return arabic ? [{ analysis, position: p }] : [];
      });
      if (kept.length === 0) return;
      const analyses = kept.map((k) => k.analysis);
      const positions = kept.map((k) => k.position);
      const words: HeardWord[] = kept.map(({ analysis, position }) => ({
        surface: cleanSurface(analysis.surface),
        analysis,
        tokenPosition: position,
      }));
      const lemmaIds = this.store.recordHeardWords(u.utteranceId, u.heardAt, words);
      // Lemmas new to the Vocabulary get their Word Card alongside the glosses.
      const wordCards = this.guides?.lemmasHeard(lemmaIds);
      try {
        // A Token covering several analyzed words takes the first one's Lemma and gloss.
        const tokenLemmas = new Map<number, number>();
        const tokenAnalyses = new Map<number, TokenAnalysis>();
        positions.forEach((p, i) => {
          if (p === null || tokenLemmas.has(p)) return;
          tokenLemmas.set(p, lemmaIds[i]);
          tokenAnalyses.set(p, analyses[i]);
        });
        if (tokenLemmas.size === 0) return;
        const glosses = await this.glosses(u, tokenAnalyses);
        this.store.setTokenGlosses(u.utteranceId, glosses);
        this.update(u, {
          tokens: tokens.map((t, i) => ({
            ...t,
            lemmaId: tokenLemmas.get(i) ?? t.lemmaId,
            gloss: glosses.get(i) ?? t.gloss,
          })),
        });
      } finally {
        await wordCards;
      }
    } catch (err) {
      console.error(`Arabic analysis failed for an Utterance in Session ${u.sessionId}:`, err);
    }
  }

  /**
   * The quick gloss per Token position: the dictionary's first sense of its Lemma, else
   * the analyzer's stem gloss. A failed lookup falls back the same way.
   */
  private async glosses(u: FinalUtterance, byToken: Map<number, TokenAnalysis>): Promise<Map<number, string>> {
    const glosses = new Map<number, string>();
    await Promise.all(
      [...byToken].map(async ([position, a]) => {
        let entry: DictionaryEntry | undefined;
        try {
          entry = await this.providers.dictionary.lookup(a.lemma, a.partOfSpeech);
        } catch (err) {
          console.error(`Dictionary lookup failed for a word in Session ${u.sessionId}:`, err);
        }
        const gloss = quickGloss(entry, a.stemGloss, a.partOfSpeech);
        if (gloss) glosses.set(position, gloss);
      }),
    );
    return glosses;
  }
}
