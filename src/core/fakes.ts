import type {
  ArabicAnalyzer,
  Dictionary,
  DictionaryEntry,
  ExampleSentence,
  SpeechToText,
  SttEvent,
  TokenAnalysis,
  Translator,
} from './providers';

/** Consumes the whole audio stream, then replays a scripted list of events. */
export class FakeSpeechToText implements SpeechToText {
  /** Every audio byte this provider was given, in order. */
  received = new Uint8Array();

  constructor(private readonly script: SttEvent[]) {}

  async *transcribe(audio: AsyncIterable<Uint8Array>): AsyncIterable<SttEvent> {
    for await (const chunk of audio) {
      const joined = new Uint8Array(this.received.length + chunk.length);
      joined.set(this.received);
      joined.set(chunk, this.received.length);
      this.received = joined;
    }
    yield* this.script;
  }
}

/** Translates from a fixed table; unknown sentences translate to ''. */
export class FakeTranslator implements Translator {
  constructor(private readonly table: Record<string, string> = {}) {}

  async translate(arabic: string): Promise<string> {
    return this.table[arabic] ?? '';
  }
}

/**
 * Splits on whitespace and drops punctuation, like the real helper. Each word's Lemma
 * comes from `lemmas`, keyed by surface form; any other word is its own Lemma.
 */
export class FakeArabicAnalyzer implements ArabicAnalyzer {
  constructor(private readonly lemmas: Record<string, string> = {}) {}

  async analyze(sentence: string): Promise<TokenAnalysis[]> {
    return sentence
      .split(/\s+/)
      .map((word) => word.replace(/[\p{P}\p{S}]/gu, ''))
      .filter(Boolean)
      .map((surface) => ({ surface, lemma: this.lemmas[surface] ?? surface }));
  }
}

/**
 * Looks Lemmas up in a small fixed table. Examples are found by whole words, spelled
 * exactly as given.
 */
export class FakeDictionary implements Dictionary {
  constructor(
    private readonly entries: Record<string, string[] | Omit<DictionaryEntry, 'lemma'>> = {},
    private readonly sentences: ExampleSentence[] = [],
  ) {}

  async lookup(lemma: string): Promise<DictionaryEntry | undefined> {
    const entry = this.entries[lemma];
    if (!entry) return undefined;
    return Array.isArray(entry) ? { lemma, definitions: entry } : { lemma, ...entry };
  }

  async examples(words: string[], limit: number): Promise<ExampleSentence[]> {
    const wanted = new Set(words);
    return this.sentences
      .filter((s) => s.arabic.split(/\s+/).some((w) => wanted.has(w.replace(/[\p{P}\p{S}]/gu, ''))))
      .slice(0, limit);
  }
}
