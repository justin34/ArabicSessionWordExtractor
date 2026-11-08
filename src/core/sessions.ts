import { appendFileSync, createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { alignToTokens, cleanSurface, hasArabicWord, isArabicWord, isWord } from './analysis/align';
import { AudioChannel } from './audioChannel';
import { quickGloss } from './dictionary/gloss';
import type { StudyGuideHooks } from './guides/studyGuides';
import type { DictionaryEntry, Providers, TokenAnalysis } from './providers';
import type { HeardWord, Store } from './store';
import type {
  LiveUtterance,
  Session,
  Token,
  Track,
  TranscriptionFailureListener,
  TranscriptListener,
  Utterance,
} from './types';

/** One Track's speech-to-text stream (ADR 0004: never one mixed stream). */
interface TrackStream {
  track: Track;
  audio: AudioChannel;
  /** False once speech-to-text has failed; audio then goes to the Track's file only. */
  transcribing: boolean;
  /** Why this stream stopped before the Session did; undefined while it works. */
  failure?: string;
  /** Settles when the provider pipeline has drained. Never rejects. */
  transcribed: Promise<void>;
}

interface LiveSession {
  desktopTrackPath: string;
  /** Null when the learner chose not to record the microphone. */
  micTrackPath: string | null;
  desktop: TrackStream;
  /** The Mic Track's own stream, only when the learner asked for their speech transcribed. */
  mic: TrackStream | null;
  /** True when the mic stream is fed gated audio of its own, not the Mic Track as recorded. */
  gateMic: boolean;
  /** Set once the Session is being stopped, so a stream ending then is no failure. */
  stopping: boolean;
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

/** How long analysis waits for an Utterance's translation before going on without it. */
const DEFAULT_TRANSLATION_WAIT_MS = 3000;

export interface StartOptions {
  /** Also record the microphone, as the Mic Track. */
  mic?: boolean;
  /** Also transcribe the Mic Track, as Learner Utterances; needs `mic`. */
  transcribeMic?: boolean;
  /**
   * The mic threshold is set: speech-to-text hears the gated mic audio sent with
   * `appendGatedMicAudio`, never the Mic Track itself; needs `transcribeMic`.
   */
  gateMic?: boolean;
}

export interface SessionsOptions {
  /** How long analysis waits for an Utterance's translation; 3 s by default. */
  translationWaitMs?: number;
}

/**
 * The Session pipeline. Desktop audio streamed into a live Session is written to its
 * Desktop Track and, at the same time, fed to speech-to-text; each final Utterance is
 * stored in the Session's Transcript and shown at once, then translated and analyzed.
 * Analysis waits briefly for the translation, which helps it pick each word's reading,
 * and resolves the words to Lemmas, which go into the Vocabulary. When the learner asks,
 * the Mic Track gets its own stream too: its Learner Utterances are stored and translated,
 * but never analyzed, so nothing the learner says becomes a study word (ADR 0004).
 */
export class Sessions {
  private readonly live = new Map<number, LiveSession>();
  private readonly listeners = new Set<TranscriptListener>();
  private readonly failureListeners = new Set<TranscriptionFailureListener>();
  private readonly translationWaitMs: number;

  constructor(
    private readonly store: Store,
    private readonly providers: Providers,
    private readonly recordingsDir: string,
    /** Told of Lemmas heard and Sessions ended, for Word Cards and Session Guides. */
    private readonly guides?: StudyGuideHooks,
    { translationWaitMs = DEFAULT_TRANSLATION_WAIT_MS }: SessionsOptions = {},
  ) {
    this.translationWaitMs = translationWaitMs;
    mkdirSync(recordingsDir, { recursive: true });
    // No Session can still be live when the app opens; any left recording died with the app.
    store.completeAbandonedSessions(new Date().toISOString());
  }

  /**
   * Begins a live Session. `extension` is the Desktop Track's audio file type; with `mic`,
   * the Session also has a Mic Track, a separate file of the same type, and with
   * `transcribeMic` that Track is transcribed on a second stream.
   */
  start(extension = 'webm', { mic = false, transcribeMic = false, gateMic = false }: StartOptions = {}): Session {
    if (transcribeMic && !mic) throw new Error('Only a recorded microphone can be transcribed');
    if (gateMic && !transcribeMic) throw new Error('Only a transcribed microphone can be gated');
    const session = this.store.createSession(
      new Date().toISOString(),
      (id) => join(this.recordingsDir, `session-${id}-desktop.${extension}`),
      mic ? (id) => join(this.recordingsDir, `session-${id}-mic.${extension}`) : undefined,
    );
    writeFileSync(session.desktopTrackPath, new Uint8Array());
    if (session.micTrackPath) writeFileSync(session.micTrackPath, new Uint8Array());
    const stream = (track: Track): TrackStream => ({
      track,
      audio: new AudioChannel(),
      transcribing: true,
      transcribed: Promise.resolve(),
    });
    const live: LiveSession = {
      desktopTrackPath: session.desktopTrackPath,
      micTrackPath: session.micTrackPath,
      desktop: stream('desktop'),
      mic: transcribeMic ? stream('mic') : null,
      gateMic,
      stopping: false,
      followUps: new Set(),
    };
    this.live.set(session.id, live);
    for (const s of [live.desktop, live.mic]) {
      if (s) s.transcribed = this.transcribe(session.id, live, s);
    }
    return session;
  }

  appendDesktopAudio(sessionId: number, chunk: Uint8Array): void {
    const live = this.live.get(sessionId);
    if (!live) throw new Error(`Session ${sessionId} is not recording`);
    appendFileSync(live.desktopTrackPath, chunk);
    if (live.desktop.transcribing) live.desktop.audio.push(chunk);
  }

  /**
   * Writes microphone audio to the Session's Mic Track. It is sent for transcription only
   * when the Session was started with `transcribeMic`, and not with `gateMic`.
   */
  appendMicAudio(sessionId: number, chunk: Uint8Array): void {
    const live = this.live.get(sessionId);
    if (!live) throw new Error(`Session ${sessionId} is not recording`);
    if (!live.micTrackPath) throw new Error(`Session ${sessionId} has no Mic Track`);
    appendFileSync(live.micTrackPath, chunk);
    if (!live.gateMic && live.mic?.transcribing) live.mic.audio.push(chunk);
  }

  /**
   * Sends gated microphone audio to speech-to-text, for a Session started with `gateMic`:
   * the Mic Track's timeline, with what was below the mic threshold silenced. Never
   * written to the Mic Track, which keeps everything.
   */
  appendGatedMicAudio(sessionId: number, chunk: Uint8Array): void {
    const live = this.live.get(sessionId);
    if (!live) throw new Error(`Session ${sessionId} is not recording`);
    if (!live.gateMic) throw new Error(`Session ${sessionId} has no gated mic audio`);
    if (live.mic?.transcribing) live.mic.audio.push(chunk);
  }

  /**
   * Ends the recording, waits for the Transcript to be finished, completes the Session
   * and generates its Session Guide.
   */
  async stop(sessionId: number): Promise<Session> {
    const live = this.live.get(sessionId);
    if (!live) return this.store.getSession(sessionId);
    this.live.delete(sessionId);
    live.stopping = true;
    live.desktop.audio.close();
    live.mic?.audio.close();
    await Promise.all([live.desktop.transcribed, live.mic?.transcribed]);
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

  /**
   * Told when a live Session's speech-to-text stops early on a Track: the provider failed,
   * the stream dropped, or there is no key. The Session's audio keeps recording, and the
   * other Track's stream carries on.
   */
  subscribeTranscriptionFailures(listener: TranscriptionFailureListener): () => void {
    this.failureListeners.add(listener);
    return () => void this.failureListeners.delete(listener);
  }

  /**
   * Why a live Session's speech-to-text stopped on a Track; undefined while it works, when
   * that Track is not transcribed, or once the Session ends.
   */
  transcriptionFailure(sessionId: number, track: Track = 'desktop'): string | undefined {
    const live = this.live.get(sessionId);
    return (track === 'mic' ? live?.mic : live?.desktop)?.failure;
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

  /** Path of a Session's Mic Track, for Replay; undefined when it has none or does not exist. */
  micTrackPath(sessionId: number): string | undefined {
    try {
      return this.store.getSession(sessionId).micTrackPath ?? undefined;
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

  private async transcribe(sessionId: number, live: LiveSession, stream: TrackStream): Promise<void> {
    const { track } = stream;
    const learner = track === 'mic';
    // Interim text and the final Utterance it becomes share one live id; the Tracks' never clash.
    let utteranceIndex = 0;
    const liveId = (n: number) => (learner ? `mic-${n}` : String(n));
    // A Learner Utterance says where it is from; Live View interleaves both Tracks by start.
    const placed = (startMs: number) => (learner ? { track, startMs } : { startMs });
    try {
      for await (const event of this.providers.speechToText.transcribe(stream.audio)) {
        const id = liveId(utteranceIndex);
        if (event.type === 'interim') {
          this.emit(sessionId, {
            id,
            isFinal: false,
            text: event.text,
            translation: '',
            tokens: [],
            ...placed(event.startMs),
          });
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
        const final: LiveUtterance = {
          id,
          isFinal: true,
          text: event.text,
          translation: '',
          tokens,
          ...placed(event.startMs),
        };
        const utteranceId = this.store.addUtterance({
          sessionId,
          text: event.text,
          translation: '',
          startMs: event.startMs,
          endMs: event.endMs,
          tokens,
          track,
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
        // Neither holds up the next Utterance's speech-to-text. A Learner Utterance is
        // translated, never analyzed: its words get no Lemma and no gloss (ADR 0004).
        const translated = this.translate(utterance);
        const work = [translated.then(() => {})];
        if (!learner) work.push(this.analyze(utterance, this.withinWait(translated)));
        for (const w of work) {
          const followUp = w.finally(() => live.followUps.delete(followUp));
          live.followUps.add(followUp);
        }
      }
      // A stream that ends while the Session still records was dropped by the service.
      if (!live.stopping) this.failTranscription(sessionId, stream, 'The speech-to-text service ended the stream early.');
    } catch (err) {
      // Each Track is written independently; a provider failure must never lose audio.
      console.error(`Transcription of the ${track} track failed for Session ${sessionId}:`, err);
      if (!live.stopping) this.failTranscription(sessionId, stream, (err as Error).message || String(err));
    } finally {
      // Nothing reads the channel any more, so stop queueing audio into it.
      stream.transcribing = false;
    }
  }

  private failTranscription(sessionId: number, stream: TrackStream, message: string): void {
    stream.transcribing = false;
    stream.failure = message;
    for (const listener of this.failureListeners) {
      try {
        listener(sessionId, message, stream.track);
      } catch (err) {
        console.error('Transcription failure listener failed:', err);
      }
    }
  }

  /** Sends a final Utterance again with what has filled in since. */
  private update(u: FinalUtterance, change: Partial<LiveUtterance>): void {
    u.current = { ...u.current, ...change };
    this.emit(u.sessionId, u.current);
  }

  /**
   * Adds the sentence translation to a final Utterance, and resolves to it. A failure
   * leaves the Utterance untranslated and resolves to ''.
   */
  private async translate(u: FinalUtterance): Promise<string> {
    try {
      const translation = await this.providers.translator.translate(u.current.text);
      if (!translation) return '';
      this.store.setTranslation(u.utteranceId, translation);
      this.update(u, { translation });
      return translation;
    } catch (err) {
      console.error(`Translation failed for an Utterance in Session ${u.sessionId}:`, err);
      // The Arabic stays as it is; Live View warns that translation is not working.
      this.update(u, { translationError: (err as Error).message || String(err) });
      return '';
    }
  }

  /** The translation if it arrives within the wait, else ''. */
  private withinWait(translated: Promise<string>): Promise<string> {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve(''), this.translationWaitMs);
    });
    return Promise.race([translated, late]).finally(() => clearTimeout(timer));
  }

  /**
   * Resolves a final Utterance's words to Lemmas and adds them to the Vocabulary, once
   * its translation is in (or given up on). A failure leaves its words out of the
   * Vocabulary and its Tokens without Lemmas.
   */
  private async analyze(u: FinalUtterance, translation: Promise<string>): Promise<void> {
    try {
      const english = await translation;
      const analyzed = (
        await this.providers.arabicAnalyzer.analyze(u.current.text, english || undefined)
      ).filter((a) => isWord(a.surface));
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
