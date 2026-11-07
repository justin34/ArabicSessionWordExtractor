export type SessionStatus = 'recording' | 'completed';

export interface Session {
  id: number;
  startedAt: string;
  endedAt: string | null;
  status: SessionStatus;
  desktopTrackPath: string;
}

export interface Utterance {
  id: number;
  sessionId: number;
  text: string;
  translation: string;
  startMs: number;
  endMs: number;
}
