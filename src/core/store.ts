import { DatabaseSync } from 'node:sqlite';
import type { Session, SessionStatus, Utterance } from './types';

interface SessionRow {
  id: number;
  started_at: string;
  ended_at: string | null;
  status: SessionStatus;
  desktop_track_path: string;
}

interface UtteranceRow {
  id: number;
  session_id: number;
  text: string;
  translation: string;
  start_ms: number;
  end_ms: number;
}

const toSession = (r: SessionRow): Session => ({
  id: r.id,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  status: r.status,
  desktopTrackPath: r.desktop_track_path,
});

const toUtterance = (r: UtteranceRow): Utterance => ({
  id: r.id,
  sessionId: r.session_id,
  text: r.text,
  translation: r.translation,
  startMs: r.start_ms,
  endMs: r.end_ms,
});

/** Local SQLite storage for Sessions and their Transcripts. */
export class Store {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        status TEXT NOT NULL,
        desktop_track_path TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS utterances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id),
        text TEXT NOT NULL,
        translation TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL
      );
    `);
  }

  /** Creates a recording Session; desktopTrackPathFor derives its Desktop Track path from the new id. */
  createSession(startedAt: string, desktopTrackPathFor: (id: number) => string): Session {
    this.db.exec('BEGIN');
    try {
      const id = Number(
        this.db
          .prepare(
            "INSERT INTO sessions (started_at, status, desktop_track_path) VALUES (?, 'recording', '')",
          )
          .run(startedAt).lastInsertRowid,
      );
      this.db
        .prepare('UPDATE sessions SET desktop_track_path = ? WHERE id = ?')
        .run(desktopTrackPathFor(id), id);
      this.db.exec('COMMIT');
      return this.getSession(id);
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Completes Sessions still marked recording, e.g. after the app was killed mid-Session. */
  completeAbandonedSessions(endedAt: string): void {
    this.db
      .prepare("UPDATE sessions SET status = 'completed', ended_at = ? WHERE status = 'recording'")
      .run(endedAt);
  }

  getSession(id: number): Session {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as unknown as
      | SessionRow
      | undefined;
    if (!row) throw new Error(`Session ${id} not found`);
    return toSession(row);
  }

  completeSession(id: number, endedAt: string): Session {
    this.db
      .prepare("UPDATE sessions SET status = 'completed', ended_at = ? WHERE id = ?")
      .run(endedAt, id);
    return this.getSession(id);
  }

  listSessions(): Session[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions ORDER BY id DESC')
      .all() as unknown as SessionRow[];
    return rows.map(toSession);
  }

  addUtterance(u: Omit<Utterance, 'id'>): void {
    this.db
      .prepare(
        'INSERT INTO utterances (session_id, text, translation, start_ms, end_ms) VALUES (?, ?, ?, ?, ?)',
      )
      .run(u.sessionId, u.text, u.translation, u.startMs, u.endMs);
  }

  getTranscript(sessionId: number): Utterance[] {
    const rows = this.db
      .prepare('SELECT * FROM utterances WHERE session_id = ? ORDER BY start_ms, id')
      .all(sessionId) as unknown as UtteranceRow[];
    return rows.map(toUtterance);
  }

  close(): void {
    this.db.close();
  }
}
