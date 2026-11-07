export type SessionStatus = 'recording' | 'completed';

export interface Session {
  id: number;
  startedAt: string;
  endedAt: string | null;
  status: SessionStatus;
  desktopTrackPath: string;
}

/** One word occurrence in an Utterance. */
export interface Token {
  surface: string;
  startMs: number;
  endMs: number;
  /** English gloss shown under the word. */
  gloss: string;
  /** Id of the Lemma this Token resolves to, once lemmatization exists. */
  lemmaId: number | null;
}

export interface Utterance {
  id: number;
  sessionId: number;
  text: string;
  translation: string;
  startMs: number;
  endMs: number;
  /** Empty while the Utterance is interim, and until the real pipeline produces Tokens. */
  tokens: Token[];
}

/**
 * A Transcript update streamed to Live View while a Session records. Interim text is
 * re-sent under the same id until that Utterance is final; then it carries its
 * translation and Tokens.
 */
export interface LiveUtterance {
  id: string;
  isFinal: boolean;
  /** Arabic text (all the learner sees while interim). */
  text: string;
  /** Sentence translation; empty while interim. */
  translation: string;
  /** Tokens with timings and glosses; empty while interim. */
  tokens: Token[];
  /** Why this final Utterance could not be translated; set from the update reporting it on. */
  translationError?: string;
}

/** Where a Lemma was heard: one Utterance of one Session. */
export interface HeardIn {
  sessionId: number;
  utteranceId: number;
}

/** One Lemma in the Vocabulary (ADR 0001), with the surface forms it was heard as. */
export interface VocabularyEntry {
  lemmaId: number;
  /** Dictionary form, diacritized as the analyzer gives it. */
  lemma: string;
  root: string | null;
  partOfSpeech: string | null;
  stemGloss: string | null;
  /** Every surface form heard, in the order first heard. */
  surfaceForms: string[];
  firstHeardAt: string;
  /** Times heard, across every Session. */
  count: number;
  /** Each Utterance it was heard in, oldest first; listed once however often it occurs there. */
  heardIn: HeardIn[];
}

export type TranscriptListener = (sessionId: number, update: LiveUtterance) => void;

/** One labelled fact in a Detail Module's section, e.g. root ك.ت.ب. */
export interface DetailFact {
  label: string;
  value: string;
  /** True when the value is Arabic, shown right to left. */
  arabic?: boolean;
}

/** One item of a list, e.g. a definition or a Session. */
export interface DetailItem {
  text: string;
  /** Muted text after the item, e.g. how often the word was heard there. */
  note?: string;
}

/** An Arabic sentence with its English translation. */
export interface DetailExample {
  arabic: string;
  english: string;
  /** Where it comes from, e.g. the Session it was heard in. */
  note?: string;
}

/** A renderable part of a section. The panel shows each kind its own way. */
export type DetailBlock =
  | { kind: 'facts'; facts: DetailFact[] }
  | { kind: 'list'; items: DetailItem[]; ordered?: boolean }
  | { kind: 'text'; heading?: string; text: string }
  | { kind: 'examples'; examples: DetailExample[] };

/** What one Detail Module (ADR 0002) contributes to the word panel. */
export interface DetailSection {
  /** Id of the Detail Module that built it. */
  moduleId: string;
  title: string;
  blocks: DetailBlock[];
}

/** The word panel's content for one Lemma: the enabled modules' sections, in configured order. */
export interface WordDetails {
  lemmaId: number;
  lemma: string;
  sections: DetailSection[];
}
