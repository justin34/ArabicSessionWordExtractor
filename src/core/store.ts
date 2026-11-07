import { DatabaseSync } from 'node:sqlite';
import type { TokenAnalysis } from './providers';
import type {
  DetailSection,
  HeardIn,
  Session,
  SessionGuide,
  SessionStatus,
  Token,
  Utterance,
  VocabularyEntry,
  WordCard,
} from './types';

interface SessionRow {
  id: number;
  started_at: string;
  ended_at: string | null;
  status: SessionStatus;
  desktop_track_path: string;
  mic_track_path: string | null;
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
  micTrackPath: r.mic_track_path ?? null,
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

/** A surface form of a Lemma, with how its chosen reading is said. */
export interface HeardForm {
  surface: string;
  diacritized: string | null;
  /** Phonetic transcription of the diacritized form. */
  pronunciation: string | null;
}

/** Everything stored about one Lemma, for the Detail Modules. */
export interface LemmaRecord {
  id: number;
  lemma: string;
  root: string | null;
  partOfSpeech: string | null;
  pattern: string | null;
  stemGloss: string | null;
  firstHeardAt: string;
  count: number;
  /** In the order first heard. */
  forms: HeardForm[];
}

/** An Utterance a Lemma was heard in. */
export interface HeardUtterance {
  utteranceId: number;
  sessionId: number;
  sessionStartedAt: string;
  text: string;
  translation: string;
}

/** A Session a Lemma was heard in, and how often. */
export interface HeardSession {
  sessionId: number;
  startedAt: string;
  count: number;
}

/** A Lemma first heard in a given Session, for its Session Guide. */
export interface NewLemma {
  lemmaId: number;
  lemma: string;
  partOfSpeech: string | null;
  stemGloss: string | null;
  /** The first quick gloss one of its Tokens got in the Session, if any. */
  gloss: string | null;
  /** Times heard in the Session. */
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
      -- Study guides, stored as generated: a Word Card per Lemma, a Session Guide per Session.
      CREATE TABLE IF NOT EXISTS word_cards (
        lemma_id INTEGER PRIMARY KEY REFERENCES lemmas(id),
        generated_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sections TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_guides (
        session_id INTEGER PRIMARY KEY REFERENCES sessions(id),
        generated_at TEXT NOT NULL,
        lemmas_heard INTEGER NOT NULL,
        groups TEXT NOT NULL
      );
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
    // ... and before the word panel, without a Lemma's pattern or a form's pronunciation.
    this.addColumnIfMissing('lemmas', 'pattern', 'TEXT');
    this.addColumnIfMissing('surface_forms', 'diacritized', 'TEXT');
    this.addColumnIfMissing('surface_forms', 'pronunciation', 'TEXT');
    // ... and before the Mic Track.
    this.addColumnIfMissing('sessions', 'mic_track_path', 'TEXT');
  }

  private addColumnIfMissing(table: string, column: string, type: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }

  /**
   * Creates a recording Session; desktopTrackPathFor derives its Desktop Track path from the
   * new id, and micTrackPathFor, when given, its Mic Track path.
   */
  createSession(
    startedAt: string,
    desktopTrackPathFor: (id: number) => string,
    micTrackPathFor?: (id: number) => string,
  ): Session {
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
        .prepare('UPDATE sessions SET desktop_track_path = ?, mic_track_path = ? WHERE id = ?')
        .run(desktopTrackPathFor(id), micTrackPathFor?.(id) ?? null, id);
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
      `INSERT INTO lemmas (lemma, root, part_of_speech, stem_gloss, pattern, first_heard_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (lemma) DO UPDATE SET
         root = coalesce(root, excluded.root),
         part_of_speech = coalesce(part_of_speech, excluded.part_of_speech),
         stem_gloss = coalesce(stem_gloss, excluded.stem_gloss),
         pattern = coalesce(pattern, excluded.pattern),
         first_heard_at = min(first_heard_at, excluded.first_heard_at)
       RETURNING id`,
    );
    const addSurface = this.db.prepare(
      `INSERT INTO surface_forms (lemma_id, surface, first_heard_at, seq, diacritized, pronunciation)
       VALUES (?, ?, ?, (SELECT count(*) FROM surface_forms WHERE lemma_id = ?), ?, ?)
       ON CONFLICT (lemma_id, surface) DO UPDATE SET
         first_heard_at = min(first_heard_at, excluded.first_heard_at),
         diacritized = coalesce(diacritized, excluded.diacritized),
         pronunciation = coalesce(pronunciation, excluded.pronunciation)`,
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
          a.pattern ?? null,
          heardAt,
        ) as { id: number };
        addSurface.run(row.id, w.surface, heardAt, row.id, a.diacritized ?? null, a.pronunciation ?? null);
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

  /** One Lemma of the Vocabulary, or undefined for an id that is none. */
  getLemma(lemmaId: number): LemmaRecord | undefined {
    const l = this.db
      .prepare(
        `SELECT l.*, (SELECT count(*) FROM occurrences o WHERE o.lemma_id = l.id) AS count
         FROM lemmas l WHERE l.id = ?`,
      )
      .get(lemmaId) as unknown as (LemmaRow & { pattern: string | null }) | undefined;
    if (!l) return undefined;
    const forms = this.db
      .prepare(
        `SELECT surface, diacritized, pronunciation FROM surface_forms
         WHERE lemma_id = ? ORDER BY first_heard_at, seq`,
      )
      .all(lemmaId) as unknown as HeardForm[];
    return {
      id: l.id,
      lemma: l.lemma,
      root: l.root,
      partOfSpeech: l.part_of_speech,
      pattern: l.pattern,
      stemGloss: l.stem_gloss,
      firstHeardAt: l.first_heard_at,
      count: l.count,
      forms: forms.map((f) => ({ ...f })),
    };
  }

  /** The Utterances a Lemma was heard in, most recent first, at most `limit`. */
  lemmaUtterances(lemmaId: number, limit: number): HeardUtterance[] {
    return this.db
      .prepare(
        `SELECT u.id AS utteranceId, u.session_id AS sessionId, s.started_at AS sessionStartedAt,
                u.text, u.translation
         FROM utterances u JOIN sessions s ON s.id = u.session_id
         WHERE u.id IN (SELECT utterance_id FROM occurrences WHERE lemma_id = ?)
         ORDER BY s.started_at DESC, u.session_id DESC, u.start_ms DESC, u.id DESC
         LIMIT ?`,
      )
      .all(lemmaId, limit)
      .map((r) => ({ ...r })) as unknown as HeardUtterance[];
  }

  /** The Sessions a Lemma was heard in, most recent first, with times heard in each. */
  lemmaSessions(lemmaId: number): HeardSession[] {
    return this.db
      .prepare(
        `SELECT s.id AS sessionId, s.started_at AS startedAt, count(*) AS count
         FROM occurrences o JOIN utterances u ON u.id = o.utterance_id JOIN sessions s ON s.id = u.session_id
         WHERE o.lemma_id = ?
         GROUP BY s.id ORDER BY s.started_at DESC, s.id DESC`,
      )
      .all(lemmaId)
      .map((r) => ({ ...r })) as unknown as HeardSession[];
  }

  /**
   * Stores a Lemma's Word Card. A new card is created; an existing one is rebuilt only
   * when `replace` is set, keeping when it was first generated.
   */
  putWordCard(lemmaId: number, sections: DetailSection[], at: string, replace: boolean): void {
    const json = JSON.stringify(sections);
    if (replace) {
      this.db
        .prepare(
          `INSERT INTO word_cards (lemma_id, generated_at, updated_at, sections) VALUES (?, ?, ?, ?)
           ON CONFLICT (lemma_id) DO UPDATE SET updated_at = excluded.updated_at, sections = excluded.sections`,
        )
        .run(lemmaId, at, at, json);
    } else {
      this.db
        .prepare(
          'INSERT OR IGNORE INTO word_cards (lemma_id, generated_at, updated_at, sections) VALUES (?, ?, ?, ?)',
        )
        .run(lemmaId, at, at, json);
    }
  }

  getWordCard(lemmaId: number): WordCard | undefined {
    const row = this.db
      .prepare(
        `SELECT c.lemma_id, l.lemma, c.generated_at, c.updated_at, c.sections
         FROM word_cards c JOIN lemmas l ON l.id = c.lemma_id WHERE c.lemma_id = ?`,
      )
      .get(lemmaId) as
      | { lemma_id: number; lemma: string; generated_at: string; updated_at: string; sections: string }
      | undefined;
    if (!row) return undefined;
    return {
      lemmaId: row.lemma_id,
      lemma: row.lemma,
      generatedAt: row.generated_at,
      updatedAt: row.updated_at,
      sections: JSON.parse(row.sections) as DetailSection[],
    };
  }

  /** Lemmas of the Vocabulary that have no Word Card yet, e.g. heard before Word Cards existed. */
  lemmasWithoutWordCard(): number[] {
    return (
      this.db
        .prepare('SELECT id FROM lemmas WHERE id NOT IN (SELECT lemma_id FROM word_cards) ORDER BY id')
        .all() as Array<{ id: number }>
    ).map((r) => r.id);
  }

  /** Every Lemma heard in a Session. */
  sessionLemmaIds(sessionId: number): number[] {
    return (
      this.db
        .prepare(
          `SELECT DISTINCT o.lemma_id AS id FROM occurrences o JOIN utterances u ON u.id = o.utterance_id
           WHERE u.session_id = ? ORDER BY o.lemma_id`,
        )
        .all(sessionId) as Array<{ id: number }>
    ).map((r) => r.id);
  }

  /**
   * The Lemmas first heard in a Session (heard in no earlier Session), in the order heard
   * there, with their times heard in it and the first quick gloss a Token of theirs got.
   */
  newLemmasInSession(sessionId: number): NewLemma[] {
    return this.db
      .prepare(
        `SELECT l.id AS lemmaId, l.lemma, l.part_of_speech AS partOfSpeech, l.stem_gloss AS stemGloss,
                count(*) AS count,
                (SELECT t.gloss FROM tokens t JOIN utterances tu ON tu.id = t.utterance_id
                 WHERE t.lemma_id = l.id AND tu.session_id = ?1 AND t.gloss <> ''
                 ORDER BY tu.start_ms, tu.id, t.position LIMIT 1) AS gloss,
                min(printf('%012d %012d %06d', u.start_ms, u.id, o.position)) AS heardOrder
         FROM occurrences o JOIN utterances u ON u.id = o.utterance_id JOIN lemmas l ON l.id = o.lemma_id
         WHERE u.session_id = ?1
           AND NOT EXISTS (
             SELECT 1 FROM occurrences po JOIN utterances pu ON pu.id = po.utterance_id
             WHERE po.lemma_id = l.id AND pu.session_id < ?1)
         GROUP BY l.id ORDER BY heardOrder, l.id`,
      )
      .all(sessionId)
      .map(({ heardOrder: _, ...r }) => ({ ...r })) as unknown as NewLemma[];
  }

  putSessionGuide(guide: SessionGuide): void {
    this.db
      .prepare(
        `INSERT INTO session_guides (session_id, generated_at, lemmas_heard, groups) VALUES (?, ?, ?, ?)
         ON CONFLICT (session_id) DO UPDATE SET
           generated_at = excluded.generated_at, lemmas_heard = excluded.lemmas_heard, groups = excluded.groups`,
      )
      .run(guide.sessionId, guide.generatedAt, guide.lemmasHeard, JSON.stringify(guide.groups));
  }

  getSessionGuide(sessionId: number): SessionGuide | undefined {
    const row = this.db.prepare('SELECT * FROM session_guides WHERE session_id = ?').get(sessionId) as
      | { session_id: number; generated_at: string; lemmas_heard: number; groups: string }
      | undefined;
    if (!row) return undefined;
    return {
      sessionId: row.session_id,
      generatedAt: row.generated_at,
      lemmasHeard: row.lemmas_heard,
      groups: JSON.parse(row.groups) as SessionGuide['groups'],
    };
  }

  /**
   * Takes Foreign words (GLOSSARY) back out of the Vocabulary, for data stored before they
   * were kept out: their Tokens lose Lemma and gloss, their occurrences and surface forms go,
   * and so does every Lemma left foreign or unheard, with its Word Card and its place in
   * stored Session Guides. The rest of each guide stays as generated. Returns the Lemma ids
   * removed.
   */
  removeForeignWords(isArabic: (word: string) => boolean): number[] {
    const foreign = <T>(rows: T[], word: (r: T) => string) => rows.filter((r) => !isArabic(word(r)));
    this.db.exec('BEGIN');
    try {
      const tokens = foreign(
        this.db
          .prepare("SELECT utterance_id, position, surface FROM tokens WHERE lemma_id IS NOT NULL OR gloss <> ''")
          .all() as Array<{ utterance_id: number; position: number; surface: string }>,
        (r) => r.surface,
      );
      const clearToken = this.db.prepare(
        "UPDATE tokens SET lemma_id = NULL, gloss = '' WHERE utterance_id = ? AND position = ?",
      );
      for (const t of tokens) clearToken.run(t.utterance_id, t.position);

      const occurrences = foreign(
        this.db.prepare('SELECT id, surface FROM occurrences').all() as Array<{ id: number; surface: string }>,
        (r) => r.surface,
      );
      const deleteOccurrence = this.db.prepare('DELETE FROM occurrences WHERE id = ?');
      for (const o of occurrences) deleteOccurrence.run(o.id);

      const forms = foreign(
        this.db.prepare('SELECT lemma_id, surface FROM surface_forms').all() as Array<{
          lemma_id: number;
          surface: string;
        }>,
        (r) => r.surface,
      );
      const deleteForm = this.db.prepare('DELETE FROM surface_forms WHERE lemma_id = ? AND surface = ?');
      for (const f of forms) deleteForm.run(f.lemma_id, f.surface);

      const lemmas = this.db
        .prepare(
          `SELECT id, lemma, NOT EXISTS (SELECT 1 FROM occurrences o WHERE o.lemma_id = l.id) AS unheard
           FROM lemmas l`,
        )
        .all() as Array<{ id: number; lemma: string; unheard: number }>;
      const removed = lemmas.filter((l) => l.unheard || !isArabic(l.lemma)).map((l) => l.id);
      if (removed.length === 0) {
        this.db.exec('COMMIT');
        return [];
      }
      for (const sql of [
        "UPDATE tokens SET lemma_id = NULL, gloss = '' WHERE lemma_id = ?",
        'DELETE FROM occurrences WHERE lemma_id = ?',
        'DELETE FROM surface_forms WHERE lemma_id = ?',
        'DELETE FROM word_cards WHERE lemma_id = ?',
        'DELETE FROM lemmas WHERE id = ?',
      ]) {
        const statement = this.db.prepare(sql);
        for (const id of removed) statement.run(id);
      }

      const gone = new Set(removed);
      const guides = this.db.prepare('SELECT session_id, lemmas_heard, groups FROM session_guides').all() as Array<{
        session_id: number;
        lemmas_heard: number;
        groups: string;
      }>;
      const updateGuide = this.db.prepare(
        'UPDATE session_guides SET lemmas_heard = ?, groups = ? WHERE session_id = ?',
      );
      for (const g of guides) {
        const groups = JSON.parse(g.groups) as SessionGuide['groups'];
        const kept = groups
          .map((group) => ({ ...group, words: group.words.filter((w) => !gone.has(w.lemmaId)) }))
          .filter((group) => group.words.length > 0);
        const heard = this.sessionLemmaIds(g.session_id).length;
        const json = JSON.stringify(kept);
        if (heard !== g.lemmas_heard || json !== JSON.stringify(groups)) updateGuide.run(heard, json, g.session_id);
      }
      this.db.exec('COMMIT');
      return removed;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Completed Sessions with no Session Guide, e.g. ended by a crash, oldest first. */
  completedSessionsWithoutGuide(): number[] {
    return (
      this.db
        .prepare(
          `SELECT id FROM sessions WHERE status = 'completed'
           AND id NOT IN (SELECT session_id FROM session_guides) ORDER BY id`,
        )
        .all() as Array<{ id: number }>
    ).map((r) => r.id);
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
