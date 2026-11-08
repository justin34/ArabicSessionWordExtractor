/**
 * Writes an Anki package (`.apkg`, GLOSSARY: Anki export): a zip holding an Anki
 * collection in the schema-11 SQLite layout every Anki since 2.1 imports, plus its media.
 * One note type and one deck, both with fixed ids, so a second export lands on the same
 * ones; notes carry a stable GUID, so importing again updates them instead of adding
 * duplicates.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { zip } from './zip';

// These ids, and the GUID salt below, were set when the app was renamed to Arabic Session
// Word Extractor (#36). Never change them again: Anki matches a re-import to the learner's
// note type, deck and notes by them, so new ones would duplicate everything already imported.
export const NOTE_TYPE_ID = 1794096000001;
export const NOTE_TYPE_NAME = 'Arabic Session Word Extractor — Arabic Word';
export const DECK_ID = 1794096000002;
export const DECK_NAME = 'Arabic Session Word Extractor - Vocabulary';
/** What each note's GUID hash starts with; fixed, like the ids above. */
const GUID_SALT = 'arabic-session-word-extractor:';

/** The note type's fields, in order; `Lemma` is the sort field. */
export const FIELDS = [
  'Lemma',
  'Gloss',
  'Definitions',
  'PartOfSpeech',
  'Root',
  'Pattern',
  'Pronunciation',
  'FormsHeard',
  'MyExample',
  'MyExampleTranslation',
  'Example',
  'ExampleTranslation',
] as const;

export type FieldName = (typeof FIELDS)[number];

/** Fields holding Arabic, edited right to left in Anki. */
const ARABIC_FIELDS = new Set<FieldName>(['Lemma', 'Root', 'Pattern', 'FormsHeard', 'MyExample', 'Example']);

/** One note, its fields already HTML. */
export interface AnkiNote {
  /** What the GUID is derived from: `lemmas.lemma`, unique in the Vocabulary. */
  key: string;
  fields: Record<FieldName, string>;
  tags: string[];
  /** When the note last changed, in ms; Anki keeps a note it has a newer copy of. */
  modifiedMs: number;
}

/** A file the cards use, e.g. the Arabic font; Anki keeps media whose name starts with `_`. */
export interface AnkiMedia {
  name: string;
  data: Uint8Array;
}

export const FONT_FILE = '_NotoNaskhArabic-Regular.woff2';

const CSS = `@font-face { font-family: "Noto Naskh Arabic"; src: url("${FONT_FILE}"); }
.card { font-family: system-ui, "Segoe UI", sans-serif; font-size: 18px; text-align: center; color: #1d1c1a; background: #fff; }
.nightMode .card, .card.nightMode { color: #ecebe6; background: #1f1f1d; }
.arabic { font-family: "Noto Naskh Arabic", "Traditional Arabic", serif; }
.lemma { font-size: 56px; line-height: 1.8; }
.gloss { font-size: 24px; font-weight: 600; margin-block: 12px; }
.facts { color: #6b685f; margin-block: 4px; }
.section { text-align: left; max-width: 36em; margin: 16px auto 0; }
.section h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #6b685f; margin: 0 0 4px; }
.example .arabic { font-size: 24px; line-height: 1.8; text-align: right; }
.example .english { color: #6b685f; }
.hl { color: #1f6f5c; font-weight: 700; }
.nightMode .hl { color: #6fc5ad; }`;

const FRONT = `<div class="arabic lemma" lang="ar" dir="rtl">{{Lemma}}</div>
{{tts ar:Lemma}}`;

// The back repeats the Lemma itself instead of {{FrontSide}}, so nothing on it is spoken.
const BACK = `<div class="arabic lemma" lang="ar" dir="rtl">{{Lemma}}</div>
<hr id="answer">
{{#Gloss}}<div class="gloss">{{Gloss}}</div>{{/Gloss}}
<div class="facts">{{PartOfSpeech}}{{#Root}} · root <span class="arabic" lang="ar" dir="rtl">{{Root}}</span>{{/Root}}{{#Pattern}} · pattern <span class="arabic" lang="ar" dir="rtl">{{Pattern}}</span>{{/Pattern}}</div>
{{#Pronunciation}}<div class="facts">/{{Pronunciation}}/</div>{{/Pronunciation}}
{{#Definitions}}<div class="section"><h3>Definitions</h3>{{Definitions}}</div>{{/Definitions}}
{{#FormsHeard}}<div class="section"><h3>Heard as</h3><div class="arabic" lang="ar" dir="rtl">{{FormsHeard}}</div></div>{{/FormsHeard}}
{{#MyExample}}<div class="section example"><h3>Your example</h3><div class="arabic" lang="ar" dir="rtl">{{MyExample}}</div><div class="english">{{MyExampleTranslation}}</div></div>{{/MyExample}}
{{#Example}}<div class="section example"><h3>Example</h3><div class="arabic" lang="ar" dir="rtl">{{Example}}</div><div class="english">{{ExampleTranslation}}</div></div>{{/Example}}`;

/** A note's GUID: a hash of its Lemma, the same in every export. */
export function noteGuid(key: string): string {
  return createHash('sha256').update(GUID_SALT + key.normalize('NFC')).digest('base64url').slice(0, 16);
}

/** A stable positive id below 2^53 from a string, for note and card ids. */
function stableId(seed: string): number {
  const hash = createHash('sha256').update(seed).digest();
  // 47 bits keeps the id a positive, safe integer; Anki gives an import a new id on a clash.
  return hash.readUIntBE(0, 6) % 2 ** 47 + 1;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Anki's checksum of the sort field: the first 32 bits of its SHA-1, as a number. */
function fieldChecksum(field: string): number {
  return parseInt(createHash('sha1').update(stripHtml(field)).digest('hex').slice(0, 8), 16);
}

function noteType(modSec: number) {
  return {
    id: NOTE_TYPE_ID,
    name: NOTE_TYPE_NAME,
    type: 0,
    mod: modSec,
    usn: -1,
    sortf: 0,
    did: DECK_ID,
    tmpls: [
      {
        name: 'Recognition',
        ord: 0,
        qfmt: FRONT,
        afmt: BACK,
        bqfmt: '',
        bafmt: '',
        did: null,
        bfont: '',
        bsize: 0,
      },
    ],
    flds: FIELDS.map((name, ord) => ({
      name,
      ord,
      sticky: false,
      rtl: ARABIC_FIELDS.has(name),
      font: ARABIC_FIELDS.has(name) ? 'Noto Naskh Arabic' : 'Arial',
      size: ARABIC_FIELDS.has(name) ? 24 : 18,
      media: [],
    })),
    css: CSS,
    latexPre:
      '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
    latexPost: '\\end{document}',
    latexsvg: false,
    req: [[0, 'any', [0]]],
    tags: [],
    vers: [],
  };
}

function deck(id: number, name: string, modSec: number) {
  return {
    id,
    name,
    mod: modSec,
    usn: -1,
    lrnToday: [0, 0],
    revToday: [0, 0],
    newToday: [0, 0],
    timeToday: [0, 0],
    collapsed: false,
    browserCollapsed: false,
    desc: '',
    dyn: 0,
    conf: 1,
    extendNew: 0,
    extendRev: 0,
  };
}

const DECK_CONFIG = {
  1: {
    id: 1,
    name: 'Default',
    mod: 0,
    usn: 0,
    maxTaken: 60,
    autoplay: true,
    timer: 0,
    replayq: true,
    dyn: false,
    new: { delays: [1, 10], ints: [1, 4, 0], initialFactor: 2500, order: 1, perDay: 20, bury: false },
    lapse: { delays: [10], mult: 0, minInt: 1, leechFails: 8, leechAction: 1 },
    rev: { perDay: 200, ease4: 1.3, ivlFct: 1, maxIvl: 36500, bury: false, hardFactor: 1.2 },
  },
};

const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null,
  ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null,
  models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null,
  usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null,
  flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null,
  mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null,
  ivl integer not null, factor integer not null, reps integer not null, lapses integer not null,
  left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null,
  ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

/** The collection as SQLite bytes, written through a temporary file. */
function collection(notes: AnkiNote[], nowMs: number): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), 'anki-export-'));
  try {
    const path = join(dir, 'collection.anki2');
    const db = new DatabaseSync(path);
    try {
      const nowSec = Math.floor(nowMs / 1000);
      const dayStart = new Date(nowMs);
      dayStart.setHours(0, 0, 0, 0);
      db.exec(SCHEMA);
      db.prepare(
        `INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
         VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')`,
      ).run(
        Math.floor(dayStart.getTime() / 1000),
        nowMs,
        nowMs,
        JSON.stringify({
          activeDecks: [DECK_ID],
          curDeck: DECK_ID,
          newSpread: 0,
          collapseTime: 1200,
          timeLim: 0,
          estTimes: true,
          dueCounts: true,
          curModel: NOTE_TYPE_ID,
          nextPos: notes.length + 1,
          sortType: 'noteFld',
          sortBackwards: false,
          addToCur: true,
        }),
        JSON.stringify({ [NOTE_TYPE_ID]: noteType(nowSec) }),
        JSON.stringify({ 1: deck(1, 'Default', nowSec), [DECK_ID]: deck(DECK_ID, DECK_NAME, nowSec) }),
        JSON.stringify(DECK_CONFIG),
      );
      const insertNote = db.prepare(
        `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
         VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')`,
      );
      const insertCard = db.prepare(
        `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
         VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')`,
      );
      db.exec('BEGIN');
      notes.forEach((note, i) => {
        const guid = noteGuid(note.key);
        const noteId = stableId(`note:${guid}`);
        const modSec = Math.floor(note.modifiedMs / 1000);
        const fields = FIELDS.map((f) => note.fields[f].replace(/\x1f/g, ' '));
        const tags = note.tags.length > 0 ? ` ${note.tags.join(' ')} ` : '';
        insertNote.run(noteId, guid, NOTE_TYPE_ID, modSec, tags, fields.join('\x1f'), stripHtml(fields[0]), fieldChecksum(fields[0]));
        insertCard.run(stableId(`card:${guid}:0`), noteId, DECK_ID, modSec, i + 1);
      });
      db.exec('COMMIT');
    } finally {
      db.close();
    }
    return new Uint8Array(readFileSync(path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The `.apkg` bytes for these notes and media files. */
export function ankiPackage(notes: AnkiNote[], media: AnkiMedia[] = [], nowMs = Date.now()): Uint8Array {
  const mediaMap = Object.fromEntries(media.map((m, i) => [String(i), m.name]));
  return zip([
    { name: 'collection.anki2', data: collection(notes, nowMs) },
    { name: 'media', data: new TextEncoder().encode(JSON.stringify(mediaMap)) },
    ...media.map((m, i) => ({ name: String(i), data: m.data })),
  ]);
}
