import type {
  ArabicAnalyzer,
  Dictionary,
  DictionaryEntry,
  SpeechToText,
  SttEvent,
  TokenAnalysis,
  Translator,
} from './providers';

/** Replays a scripted list of events once the audio stream has been fully consumed. */
export class FakeSpeechToText implements SpeechToText {
  constructor(private readonly script: SttEvent[]) {}

  async *transcribe(audio: AsyncIterable<Uint8Array>): AsyncIterable<SttEvent> {
    for await (const _chunk of audio) {
      // consume the stream like a real provider would
    }
    for (const event of this.script) yield event;
  }
}

export class FakeTranslator implements Translator {
  constructor(private readonly table: Record<string, string> = {}) {}

  async translate(arabic: string): Promise<string> {
    return this.table[arabic] ?? '';
  }
}

export class FakeArabicAnalyzer implements ArabicAnalyzer {
  async analyze(sentence: string): Promise<TokenAnalysis[]> {
    return sentence
      .split(/\s+/)
      .filter(Boolean)
      .map((surface) => ({ surface, lemma: surface }));
  }
}

export class FakeDictionary implements Dictionary {
  async lookup(_lemma: string): Promise<DictionaryEntry | undefined> {
    return undefined;
  }
}
