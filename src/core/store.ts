import { DatabaseSync } from 'node:sqlite';
import type { TokenAnalysis } from './providers';
import type { HeardIn, Session, SessionStatus, Token, Utterance, VocabularyEntry } from './types';

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

interface TokenRow {
  utterance_id: number;
  surface: string;
  start_ms: number;
  end_ms: number;
  lemma_id: number | null;
  gloss: string;
}

const toToken = (r: TokenRow): Token => ({
  surface: r.surface,
  startMs: r.start_ms,
  endMs: r.end_ms,
  gloss: r.gloss,
  lemmaId: r.lemma_id,
});

interface LemmaRow {
  id: number;
  lemma: string;
  root: string | null;
  part_of_speech: string | null;
  stem_gloss: string | null;
  first_heard_at: string;
  count: number;
}

/** One analyzed word of a final Utterance, for the Vocabulary. */
export interface HeardWord {
  /** The surface form heard, without punctuation. */
  surface: string;
  analysis: TokenAnalysis;
  /** Position of the Token it belongs to, or null when it matched none. */
  tokenPosition: number | null;
}

const toUtterance = (r: UtteranceRow, tokens: Token[]): Utterance => ({
  id: r.id,
  sessionId: r.session_id,
  text: r.text,
  translation: r.translation,
  startMs: r.start_ms,
  endMs: r.end_ms,
  tokens,
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
      CREATE TABLE IF NOT EXISTS tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        utterance_id INTEGER NOT NULL REFERENCES utterances(id),
        position INTEGER NOT NULL,
        surface TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tokens_by_utterance ON tokens (utterance_id, position);
      CREATE TABLE IF NOT EXISTS lemmas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lemma TEXT NOT NULL UNIQUE,
        root TEXT,
        part_of_speech TEXT,
        stem_gloss TEXT,
        first_heard_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS surface_forms (
        lemma_id INTEGER NOT NULL REFERENCES lemmas(id),
        surface TEXT NOT NULL,
        first_heard_at TEXT NOT NULL,
        seq INTEGER NOT NULL,
        PRIMARY KEY (lemma_id, surface)
      );
      -- Each time a Lemma was heard: append-only, so the count is the number of rows.
      CREATE TABLE IF NOT EXISTS occurrences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lemma_id INTEGER NOT NULL REFERENCES lemmas(id),
        utterance_id INTEGER NOT NULL REFERENCES utterances(id),
        position INTEGER NOT NULL,
        surface TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS occurrences_by_lemma ON occurrences (lemma_id, utterance_id);
    `);
    // Databases made before the Vocabulary have Tokens without a Lemma column.
    const tokenColumns = this.db.prepare('PRAGMA table_info(tokens)').all() as Array<{ name: string }>;
    if (!tokenColumns.some((c) => c.name === 'lemma_id')) {
      this.db.exec('ALTER TABLE tokens ADD COLUMN lemma_id INTEGER REFERENCES lemmas(id)');
    }
    // ... and before the quick gloss, without a gloss column.
    if (!tokenColumns.some((c) => c.name === 'gloss')) {
      this.db.exec("ALTER TABLE tokens ADD COLUMN gloss TEXT NOT NULL DEFAULT ''");
    }
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

  /** Stores a final Utterance and its Tokens together; returns the Utterance's id. */
  addUtterance(u: Omit<Utterance, 'id'>): number {
    this.db.exec('BEGIN');
    try {
      const id = this.db
        .prepare(
          'INSERT INTO utterances (session_id, text, translation, start_ms, end_ms) VALUES (?, ?, ?, ?, ?)',
        )
        .run(u.sessionId, u.text, u.translation, u.startMs, u.endMs).lastInsertRowid;
      const insertToken = this.db.prepare(
        'INSERT INTO tokens (utterance_id, position, surface, start_ms, end_ms) VALUES (?, ?, ?, ?, ?)',
      );
      u.tokens.forEach((t, i) => insertToken.run(id, i, t.surface, t.startMs, t.endMs));
      this.db.exec('COMMIT');
      return Number(id);
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Sets a stored Utterance's sentence translation, which arrives after the Utterance. */
  setTranslation(utteranceId: number, translation: string): void {
    this.db.prepare('UPDATE utterances SET translation = ? WHERE id = ?').run(translation, utteranceId);
  }

  /** Sets the quick gloss of an Utterance's Tokens, by Token position. */
  setTokenGlosses(utteranceId: number, glosses: Map<number, string>): void {
    const setGloss = this.db.prepare('UPDATE tokens SET gloss = ? WHERE utterance_id = ? AND position = ?');
    this.db.exec('BEGIN');
    try {
      for (const [position, gloss] of glosses) setGloss.run(gloss, utteranceId, position);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Adds an analyzed Utterance's words to the Vocabulary: a new Lemma is appended, a
   * known one gains an occurrence and any new surface form. Links each matched Token to
   * its Lemma. Returns the Lemma id per word.
   */
  recordHeardWords(utteranceId: number, heardAt: string, words: HeardWord[]): number[] {
    const upsertLemma = this.db.prepare(
      `INSERT INTO lemmas (lemma, root, part_of_speech, stem_gloss, first_heard_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (lemma) DO UPDATE SET
         root = coalesce(root, excluded.root),
         part_of_speech = coalesce(part_of_speech, excluded.part_of_speech),
         stem_gloss = coalesce(stem_gloss, excluded.stem_gloss),
         first_heard_at = min(first_heard_at, excluded.first_heard_at)
       RETURNING id`,
    );
    const addSurface = this.db.prepare(
      `INSERT INTO surface_forms (lemma_id, surface, first_heard_at, seq)
       VALUES (?, ?, ?, (SELECT count(*) FROM surface_forms WHERE lemma_id = ?))
       ON CONFLICT (lemma_id, surface) DO UPDATE SET
         first_heard_at = min(first_heard_at, excluded.first_heard_at)`,
    );
    const addOccurrence = this.db.prepare(
      'INSERT INTO occurrences (lemma_id, utterance_id, position, surface) VALUES (?, ?, ?, ?)',
    );
    const linkToken = this.db.prepare(
      'UPDATE tokens SET lemma_id = ? WHERE utterance_id = ? AND position = ? AND lemma_id IS NULL',
    );
    this.db.exec('BEGIN');
    try {
      const ids = words.map((w, position) => {
        const a = w.analysis;
        const row = upsertLemma.get(
          a.lemma,
          a.root ?? null,
          a.partOfSpeech ?? null,
          a.stemGloss ?? null,
          heardAt,
        ) as { id: number };
        addSurface.run(row.id, w.surface, heardAt, row.id);
        addOccurrence.run(row.id, utteranceId, position, w.surface);
        if (w.tokenPosition !== null) linkToken.run(row.id, utteranceId, w.tokenPosition);
        return row.id;
      });
      this.db.exec('COMMIT');
      return ids;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** The whole Vocabulary, most recently first heard first. */
  listVocabulary(): VocabularyEntry[] {
    const lemmas = this.db
      .prepare(
        `SELECT l.*, (SELECT count(*) FROM occurrences o WHERE o.lemma_id = l.id) AS count
         FROM lemmas l ORDER BY l.first_heard_at DESC, l.id DESC`,
      )
      .all() as unknown as LemmaRow[];
    const forms = new Map<number, string[]>();
    const formRows = this.db
      .prepare('SELECT lemma_id, surface FROM surface_forms ORDER BY lemma_id, first_heard_at, seq')
      .all() as unknown as Array<{ lemma_id: number; surface: string }>;
    for (const r of formRows) forms.set(r.lemma_id, [...(forms.get(r.lemma_id) ?? []), r.surface]);
    const heardIn = new Map<number, HeardIn[]>();
    const heardRows = this.db
      .prepare(
        `SELECT DISTINCT o.lemma_id, u.session_id, o.utterance_id
         FROM occurrences o JOIN utterances u ON u.id = o.utterance_id
         ORDER BY o.lemma_id, o.utterance_id`,
      )
      .all() as unknown as Array<{ lemma_id: number; session_id: number; utterance_id: number }>;
    for (const r of heardRows) {
      const list = heardIn.get(r.lemma_id) ?? [];
      list.push({ sessionId: r.session_id, utteranceId: r.utterance_id });
      heardIn.set(r.lemma_id, list);
    }
    return lemmas.map((l) => ({
      lemmaId: l.id,
      lemma: l.lemma,
      root: l.root,
      partOfSpeech: l.part_of_speech,
      stemGloss: l.stem_gloss,
      surfaceForms: forms.get(l.id) ?? [],
      firstHeardAt: l.first_heard_at,
      count: l.count,
      heardIn: heardIn.get(l.id) ?? [],
    }));
  }

  getTranscript(sessionId: number): Utterance[] {
    const rows = this.db
      .prepare('SELECT * FROM utterances WHERE session_id = ? ORDER BY start_ms, id')
      .all(sessionId) as unknown as UtteranceRow[];
    const tokenRows = this.db
      .prepare(
        `SELECT t.* FROM tokens t JOIN utterances u ON u.id = t.utterance_id
         WHERE u.session_id = ? ORDER BY t.utterance_id, t.position`,
      )
      .all(sessionId) as unknown as TokenRow[];
    const byUtterance = new Map<number, Token[]>();
    for (const r of tokenRows) {
      const list = byUtterance.get(r.utterance_id) ?? [];
      list.push(toToken(r));
      byUtterance.set(r.utterance_id, list);
    }
    return rows.map((r) => toUtterance(r, byUtterance.get(r.id) ?? []));
  }

  close(): void {
    this.db.close();
  }
}
