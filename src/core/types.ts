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
