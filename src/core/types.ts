export type SessionStatus = 'recording' | 'completed';

export interface Session {
  id: number;
  startedAt: string;
  endedAt: string | null;
  status: SessionStatus;
  desktopTrackPath: string;
  /** The optional Mic Track, chosen at Session start; never transcribed. Null without one. */
  micTrackPath: string | null;
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

/** An audio input device as the system lists it; the label is kept to name it when unplugged. */
export interface AudioDevice {
  deviceId: string;
  label: string;
}

/** Which devices a Session records from; null is the system's own choice. */
export interface AudioSettings {
  /** What is transcribed: null is all system audio (loopback); else an input device, e.g. Stereo Mix. */
  desktopSource: AudioDevice | null;
  /** The Mic Track's microphone: null is the system default. */
  microphone: AudioDevice | null;
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

/**
 * A Lemma's read-only study guide, built from the enabled Detail Modules. Generated when
 * the Lemma first enters the Vocabulary; rebuilt when a Session it was heard in ends.
 */
export interface WordCard extends WordDetails {
  /** When the card was first generated. */
  generatedAt: string;
  /** When its sections were last rebuilt. */
  updatedAt: string;
}

/** One new Lemma in a Session Guide; its Word Card has the same Lemma id. */
export interface SessionGuideWord {
  lemmaId: number;
  lemma: string;
  /** The word's quick gloss as heard in the Session, else its stem gloss; empty when it has none. */
  gloss: string;
  partOfSpeech: string | null;
  /** Times heard in this Session. */
  count: number;
}

/** New Lemmas of one kind, e.g. verbs. */
export interface SessionGuideGroup {
  title: string;
  words: SessionGuideWord[];
}

/** A Session's read-only study guide, generated when the Session ends. */
export interface SessionGuide {
  sessionId: number;
  generatedAt: string;
  /** Distinct Lemmas heard in the Session, new or not. */
  lemmasHeard: number;
  /** Lemmas first heard in this Session, grouped by part of speech, in the order heard. */
  groups: SessionGuideGroup[];
}
