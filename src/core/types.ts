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
  /** Why this final Utterance could not be translated; set only on the update reporting it. */
  translationError?: string;
}

export type TranscriptListener = (sessionId: number, update: LiveUtterance) => void;
