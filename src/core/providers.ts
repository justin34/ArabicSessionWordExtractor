/** The four swappable provider interfaces the Session pipeline is built on. */

/** One recognized word, timed from the start of the audio stream. */
export interface SttWord {
  text: string;
  startMs: number;
  endMs: number;
}

/**
 * One whole Utterance as recognized so far. Interim events repeat the Utterance's text
 * as it grows; exactly one final event then closes it, and the next event starts a new one.
 */
export interface SttEvent {
  type: 'interim' | 'final';
  text: string;
  startMs: number;
  endMs: number;
  /** The Utterance's words in order; adapters fill this on final events. */
  words?: SttWord[];
}

/** Streaming speech-to-text: audio in, interim and final Utterances with word timings out. */
export interface SpeechToText {
  transcribe(audio: AsyncIterable<Uint8Array>): AsyncIterable<SttEvent>;
}

/** A recorded audio file on disk, e.g. a Session's Mic Track. */
export interface RecordedAudio {
  path: string;
  /** Its media type, e.g. 'audio/webm' or 'audio/wav'. */
  contentType: string;
}

/**
 * Speech-to-text for a whole recording, after the fact: the file in, every recognized
 * word out, timed from the start of the file.
 */
export interface RecordedSpeechToText {
  transcribeFile(audio: RecordedAudio): Promise<SttWord[]>;
}

/** Sentence translation: Arabic sentence in, English sentence out. */
export interface Translator {
  translate(arabic: string): Promise<string>;
}

/** A prefix or suffix attached to a word, e.g. وَ "and" or هُم "their". */
export interface Clitic {
  /** Diacritized form, e.g. 'بِ'. */
  form: string;
  /** The analyzer's feature value, e.g. 'bi_prep' or '3mp_poss'. */
  feature: string;
}

/** One analysis per Token of a final sentence: the reading chosen for that word. */
export interface TokenAnalysis {
  /** The word as written in the sentence. */
  surface: string;
  /** Dictionary form (the Lemma), diacritized. */
  lemma: string;
  /** The surface form with the chosen reading's diacritics. */
  diacritized?: string;
  /** Root radicals separated by dots, e.g. 'ك.ت.ب'. */
  root?: string;
  pattern?: string;
  partOfSpeech?: string;
  /** Phonetic transcription of the diacritized form. */
  pronunciation?: string;
  stemGloss?: string;
  prefixes?: Clitic[];
  suffixes?: Clitic[];
}

/**
 * Arabic analysis: a whole final sentence in, one analysis per Token out. The sentence's
 * English translation, when there is one, helps pick each word's reading.
 */
export interface ArabicAnalyzer {
  analyze(sentence: string, translation?: string): Promise<TokenAnalysis[]>;
}

export interface DictionaryEntry {
  lemma: string;
  /** The dictionary's own diacritized headword, when it has one. */
  headword?: string;
  /** The dictionary's part of speech, when it has one. */
  partOfSpeech?: string;
  /** Senses, most common first. */
  definitions: string[];
  /** Where the word comes from, when the dictionary says. */
  etymology?: string;
}

/** A general example sentence with its English translation. */
export interface ExampleSentence {
  arabic: string;
  english: string;
}

/**
 * Dictionary: dictionary form (Lemma) in, definitions and etymology out. The analyzer's
 * part of speech, when given, helps pick between entries spelled alike. Example sentences
 * are found by the spellings of a word (its Lemma and the surface forms heard).
 */
export interface Dictionary {
  lookup(lemma: string, partOfSpeech?: string): Promise<DictionaryEntry | undefined>;
  /** Example sentences containing any of `words` as a whole word, at most `limit`. */
  examples(words: string[], limit: number): Promise<ExampleSentence[]>;
}

export interface Providers {
  speechToText: SpeechToText;
  /** Transcribes a completed Session's Mic Track afterwards; without one, that fails saying so. */
  recordedSpeechToText?: RecordedSpeechToText;
  translator: Translator;
  arabicAnalyzer: ArabicAnalyzer;
  dictionary: Dictionary;
}
