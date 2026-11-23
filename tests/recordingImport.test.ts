import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KeyedRecordedSpeechToText,
  LONG_RECORDING_NEEDS_SONIOX,
  NO_RECORDING_TRANSCRIPTION_KEY,
} from '../src/core/apiKeys';
import { createApp, type App } from '../src/core/app';
import { FakeArabicAnalyzer, FakeDictionary, FakeSpeechToText, FakeTranslator } from '../src/core/fakes';
import type { RecordedAudio, RecordedPhase, RecordedSpeechToText, SttWord } from '../src/core/providers';
import { ALREADY_IMPORTING, suggestedName, UNSUPPORTED_RECORDING } from '../src/core/recordingImport';
import { Store } from '../src/core/store';
import type { ImportStatus } from '../src/core/types';

/**
 * Import a recording (#57): an audio or video file becomes a new completed Session, made
 * in the main process in the background, transcribed by the recorded-audio path.
 */

const FIRST = 'كتب الطالب الدرس.';
const SECOND = 'شكرا';

/** Words of a sentence from `startMs`, 500 ms apart. */
function words(text: string, startMs: number): SttWord[] {
  return text.split(' ').map((w, i) => ({ text: w, startMs: startMs + i * 500, endMs: startMs + i * 500 + 400 }));
}

/** A recording's speech-to-text that answers when told to, keeping what it was given. */
class ManualRecorded implements RecordedSpeechToText {
  given: Array<RecordedAudio & { bytes: number[] }> = [];
  private settle: { resolve: (w: SttWord[]) => void; reject: (e: Error) => void } | undefined;
  private phase: ((p: RecordedPhase) => void) | undefined;
  private wasAsked: () => void = () => undefined;
  /** Settles once the recording has been handed over. */
  asked = new Promise<void>((resolve) => (this.wasAsked = resolve));

  transcribeFile(audio: RecordedAudio, onPhase?: (p: RecordedPhase) => void): Promise<SttWord[]> {
    this.given.push({ ...audio, bytes: [...readFileSync(audio.path)] });
    this.phase = onPhase;
    onPhase?.('uploading');
    this.wasAsked();
    return new Promise((resolve, reject) => (this.settle = { resolve, reject }));
  }
  transcribing() {
    this.phase?.('transcribing');
  }
  answer(w: SttWord[]) {
    this.settle!.resolve(w);
  }
  fail(message: string) {
    this.settle!.reject(new Error(message));
  }
}

let dir: string;
let app: App | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ill-import-'));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  app?.close();
  app = undefined;
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function open(recorded?: RecordedSpeechToText): App {
  app = createApp({
    dataDir: dir,
    providers: {
      speechToText: new FakeSpeechToText([]),
      recordedSpeechToText: recorded,
      translator: new FakeTranslator({ [FIRST]: 'The student wrote the lesson.', [SECOND]: 'Thanks' }),
      arabicAnalyzer: new FakeArabicAnalyzer(),
      dictionary: new FakeDictionary({ 'كتب': ['to write'] }),
    },
  });
  return app;
}

function file(name: string, bytes = [9, 8, 7, 6]): string {
  const path = join(dir, name);
  writeFileSync(path, Buffer.from(bytes));
  return path;
}

const recordings = () => readdirSync(join(dir, 'recordings'));

function statuses(core: App): ImportStatus[] {
  const seen: ImportStatus[] = [];
  core.imports.subscribe((_id, s) => seen.push(s));
  return seen;
}

describe('Import a recording', () => {
  it('makes a named, completed Imported Session: the file copied as its Desktop Track, transcribed, translated and studied', async () => {
    const recorded = new ManualRecorded();
    const core = open(recorded);
    const seen = statuses(core);
    const before = Date.now();
    const session = core.imports.start(file('Lesson 4.mp3'), 'Lesson 4', 125_000);

    expect(session).toMatchObject({ status: 'importing', name: 'Lesson 4', imported: true, micTrackPath: null });
    expect(core.sessions.list().map((s) => s.id)).toEqual([session.id]);
    expect(core.imports.status(session.id)).toEqual({ state: 'running', note: 'Copying the recording…' });

    await recorded.asked;
    expect(recorded.given[0]).toMatchObject({ contentType: 'audio/mpeg', importedDurationMs: 125_000, bytes: [9, 8, 7, 6] });
    recorded.transcribing();
    recorded.answer([...words(FIRST, 1000), ...words(SECOND, 9000)]);
    await core.imports.idle();
    await core.guides.idle();

    const done = core.sessions.list()[0];
    expect(done).toMatchObject({ id: session.id, status: 'completed', name: 'Lesson 4', imported: true });
    expect(Date.parse(done.startedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(done.endedAt!) - Date.parse(done.startedAt)).toBe(125_000);
    expect([...readFileSync(done.desktopTrackPath)]).toEqual([9, 8, 7, 6]);
    expect(done.desktopTrackPath.endsWith('.mp3')).toBe(true);
    expect(core.sessions.transcript(session.id).map((u) => [u.text, u.translation, u.track])).toEqual([
      [FIRST, 'The student wrote the lesson.', 'desktop'],
      [SECOND, 'Thanks', 'desktop'],
    ]);
    // Dated at import time: each word is first heard at the import time plus its offset in the file.
    const wrote = core.vocabulary.list().find((e) => e.lemma === 'كتب')!;
    expect(Date.parse(wrote.firstHeardAt)).toBe(Date.parse(done.startedAt) + 1000);
    expect(core.guides.sessionGuide(session.id)!.lemmasHeard).toBe(4);
    expect(core.guides.wordCard(wrote.lemmaId)).toBeDefined();
    expect(seen).toEqual([
      { state: 'running', note: 'Copying the recording…' },
      { state: 'running', note: 'Uploading…' },
      { state: 'running', note: 'Transcribing…' },
      { state: 'running', note: 'Translating 1 of 2' },
      { state: 'running', note: 'Translating 2 of 2' },
      { state: 'done' },
    ]);
  });

  it('accepts what Chromium plays, and refuses anything else, naming what it accepts', () => {
    const core = open(new ManualRecorded());
    expect(() => core.imports.start(file('notes.txt'), 'x', null)).toThrow(UNSUPPORTED_RECORDING);
    expect(() => core.imports.start(file('clip.mkv'), 'x', null)).toThrow(/mp3, m4a, aac, wav, ogg, opus, webm or mp4/);
    expect(core.sessions.list()).toEqual([]);
    expect(core.imports.start(file('Class.MP4'), null, null).desktopTrackPath.endsWith('.mp4')).toBe(true);
  });

  it('suggests the file name without its extension', () => {
    expect(suggestedName(join(dir, 'الدرس الرابع.m4a'))).toBe('الدرس الرابع');
  });

  it('runs one import at a time', async () => {
    const recorded = new ManualRecorded();
    const core = open(recorded);
    core.imports.start(file('a.wav'), 'A', null);
    expect(() => core.imports.start(file('b.wav'), 'B', null)).toThrow(ALREADY_IMPORTING);
    await recorded.asked;
    recorded.answer([]);
    await core.imports.idle();
    expect(core.sessions.list()).toHaveLength(1);
  });

  it('Cancel leaves no Session and no copied file', async () => {
    const recorded = new ManualRecorded();
    const core = open(recorded);
    const seen = statuses(core);
    const { id } = core.imports.start(file('a.ogg'), 'A', null);
    await recorded.asked;

    await core.imports.cancel(id);
    expect(core.sessions.list()).toEqual([]);
    expect(core.imports.status(id)).toBeNull();
    expect(seen.at(-1)).toEqual({ state: 'cancelled' });

    // Speech-to-text answering afterwards changes nothing.
    recorded.answer(words(FIRST, 0));
    await core.imports.idle();
    expect(core.sessions.list()).toEqual([]);
    expect(core.vocabulary.list()).toEqual([]);
    expect(recordings()).toEqual([]);
  });

  it('a failure leaves no Session and no copied file, and says why', async () => {
    const recorded = new ManualRecorded();
    const core = open(recorded);
    const seen = statuses(core);
    core.imports.start(file('a.webm'), null, null);
    await recorded.asked;
    recorded.fail('Soniox says the account is out of balance.');
    await core.imports.idle();

    expect(core.sessions.list()).toEqual([]);
    expect(recordings()).toEqual([]);
    expect(seen.at(-1)).toEqual({ state: 'failed', message: 'Soniox says the account is out of balance.', name: 'a.webm' });
  });

  it('fails without a recorded speech-to-text provider', async () => {
    const core = open(undefined);
    const seen = statuses(core);
    core.imports.start(file('a.wav'), 'A', null);
    await core.imports.idle();
    expect(seen.at(-1)).toMatchObject({ state: 'failed', name: 'A' });
    expect(core.sessions.list()).toEqual([]);
  });

  it('quitting abandons it: an import left when the app opens is deleted with its file', async () => {
    const recorded = new ManualRecorded();
    const core = open(recorded);
    const { desktopTrackPath } = core.imports.start(file('a.wav'), 'A', null);
    await recorded.asked;
    // Killed mid-import, as if the app had died: the row and file are left behind.
    core.close();
    app = undefined;
    expect(existsSync(desktopTrackPath)).toBe(true);
    const reopened = open(new ManualRecorded());
    expect(reopened.sessions.list()).toEqual([]);
    expect(existsSync(desktopTrackPath)).toBe(false);
  });

  it('abandon() cancels the import running, for a clean quit', async () => {
    const recorded = new ManualRecorded();
    const core = open(recorded);
    core.imports.start(file('a.wav'), 'A', null);
    await recorded.asked;
    await core.imports.abandon();
    expect(core.sessions.list()).toEqual([]);
  });

  it('is never offered for removal or renaming while it imports', async () => {
    const recorded = new ManualRecorded();
    const core = open(recorded);
    const { id } = core.imports.start(file('a.wav'), 'A', null);
    expect(core.library.removalRefusal(id)).toMatch(/still being imported/);
    expect(() => core.library.rename(id, 'B')).toThrow(/still being imported/);
    await recorded.asked;
    recorded.answer([]);
    await core.imports.idle();
  });

  it('Removing an Imported Session deletes the copied file', async () => {
    const recorded = new ManualRecorded();
    const core = open(recorded);
    const { id, desktopTrackPath } = core.imports.start(file('a.mp3'), 'A', 1000);
    await recorded.asked;
    recorded.answer(words(SECOND, 0));
    await core.imports.idle();
    core.library.remove(id, { keepWords: false });
    expect(existsSync(desktopTrackPath)).toBe(false);
    const store = new Store(join(dir, 'app.db'));
    try {
      expect(store.listSessions()).toEqual([]);
    } finally {
      store.close();
    }
  });
});

describe('Speech-to-text for an imported recording', () => {
  const audio = (importedDurationMs: number | null): RecordedAudio => ({
    path: 'x.mp3',
    contentType: 'audio/mpeg',
    importedDurationMs,
  });

  function keyed(keys: { soniox?: string; deepgram?: string }, sonioxFails = false) {
    const calls: string[] = [];
    const stt = new KeyedRecordedSpeechToText(
      { get: (name) => keys[name as 'soniox' | 'deepgram'] },
      {
        soniox: () => ({
          transcribeFile: async () => {
            calls.push('soniox');
            if (sonioxFails) throw new Error('Soniox failed.');
            return [];
          },
        }),
        deepgram: () => ({
          transcribeFile: async () => {
            calls.push('deepgram');
            return [];
          },
        }),
      },
    );
    return { stt, calls };
  }

  it('falls back to Deepgram when Soniox fails, for a file under 10 minutes', async () => {
    const { stt, calls } = keyed({ soniox: 's', deepgram: 'd' }, true);
    await stt.transcribeFile(audio(9 * 60_000));
    expect(calls).toEqual(['soniox', 'deepgram']);
  });

  it('never falls back to Deepgram for a file over 10 minutes, or of unknown length', async () => {
    for (const length of [11 * 60_000, null]) {
      const { stt, calls } = keyed({ soniox: 's', deepgram: 'd' }, true);
      await expect(stt.transcribeFile(audio(length))).rejects.toThrow('Soniox failed.');
      expect(calls).toEqual(['soniox']);
    }
  });

  it('uses Deepgram alone only under 10 minutes', async () => {
    const short = keyed({ deepgram: 'd' });
    await short.stt.transcribeFile(audio(60_000));
    expect(short.calls).toEqual(['deepgram']);
    const long = keyed({ deepgram: 'd' });
    await expect(long.stt.transcribeFile(audio(10 * 60_000))).rejects.toThrow(LONG_RECORDING_NEEDS_SONIOX);
    expect(long.calls).toEqual([]);
  });

  it('fails without a speech-to-text key', async () => {
    await expect(keyed({}).stt.transcribeFile(audio(1000))).rejects.toThrow(NO_RECORDING_TRANSCRIPTION_KEY);
  });

  it('keeps the Mic Track rule: Soniox, else Deepgram, without a fallback', async () => {
    const { stt, calls } = keyed({ soniox: 's', deepgram: 'd' }, true);
    await expect(stt.transcribeFile({ path: 'm.webm', contentType: 'audio/webm' })).rejects.toThrow('Soniox failed.');
    expect(calls).toEqual(['soniox']);
  });
});
