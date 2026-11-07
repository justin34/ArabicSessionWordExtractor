/** The four swappable provider interfaces the Session pipeline is built on. */

export interface SttEvent {
  type: 'interim' | 'final';
  text: string;
  startMs: number;
  endMs: number;
}

/** Streaming speech-to-text: audio in, interim and final text with timings out. */
export interface SpeechToText {
  transcribe(audio: AsyncIterable<Uint8Array>): AsyncIterable<SttEvent>;
}

/** Sentence translation: Arabic sentence in, English sentence out. */
export interface Translator {
  translate(arabic: string): Promise<string>;
}

/** One analysis per Token of a final sentence. */
export interface TokenAnalysis {
  surface: string;
  lemma: string;
  root?: string;
  partOfSpeech?: string;
  pronunciation?: string;
  stemGloss?: string;
}

/** Arabic analysis: a whole final sentence in, one analysis per Token out. */
export interface ArabicAnalyzer {
  analyze(sentence: string): Promise<TokenAnalysis[]>;
}

export interface DictionaryEntry {
  lemma: string;
  definitions: string[];
}

/** Dictionary: dictionary form (Lemma) in, definitions out. */
export interface Dictionary {
  lookup(lemma: string): Promise<DictionaryEntry | undefined>;
}

export interface Providers {
  speechToText: SpeechToText;
  translator: Translator;
  arabicAnalyzer: ArabicAnalyzer;
  dictionary: Dictionary;
}
