import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp, type App } from '../src/core/app';
import { audioFileResponse } from '../src/core/audioFile';
import { FakeArabicAnalyzer, FakeDictionary, FakeSpeechToText, FakeTranslator } from '../src/core/fakes';

let dir: string;
let app: App | undefined;
let stt: FakeSpeechToText;

function open(): App {
  stt = new FakeSpeechToText([{ type: 'final', text: 'مرحبا', startMs: 0, endMs: 500 }]);
  app = createApp({
    dataDir: dir,
    providers: {
      speechToText: stt,
      translator: new FakeTranslator(),
      arabicAnalyzer: new FakeArabicAnalyzer(),
      dictionary: new FakeDictionary({}),
    },
  });
  return app;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ill-mic-'));
});

afterEach(() => {
  app?.close();
  app = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe('Mic Track', () => {
  it('is recorded only when chosen at Session start', async () => {
    const { sessions } = open();

    const without = sessions.start();
    expect(without.micTrackPath).toBeNull();
    expect(() => sessions.appendMicAudio(without.id, new Uint8Array([1]))).toThrow(/no Mic Track/);
    await sessions.stop(without.id);
    expect(sessions.micTrackPath(without.id)).toBeUndefined();

    const withMic = sessions.start('webm', { mic: true });
    expect(withMic.micTrackPath).toMatch(/session-\d+-mic\.webm$/);
    await sessions.stop(withMic.id);
    expect(sessions.micTrackPath(withMic.id)).toBe(withMic.micTrackPath);
  });

  it('is stored as a separate file from the Desktop Track and never sent for transcription', async () => {
    const { sessions } = open();
    const { id } = sessions.start('webm', { mic: true });

    sessions.appendDesktopAudio(id, new Uint8Array([1, 2]));
    sessions.appendMicAudio(id, new Uint8Array([7, 8, 9]));
    sessions.appendDesktopAudio(id, new Uint8Array([3]));
    const done = await sessions.stop(id);

    expect(done.micTrackPath).not.toBe(done.desktopTrackPath);
    expect([...readFileSync(done.desktopTrackPath)]).toEqual([1, 2, 3]);
    expect([...readFileSync(done.micTrackPath!)]).toEqual([7, 8, 9]);
    expect([...stt.received]).toEqual([1, 2, 3]);
    expect(sessions.transcript(id).map((u) => u.text)).toEqual(['مرحبا']);
  });

  it('keeps an empty file when nothing was heard on the mic, and refuses audio after the Session ends', async () => {
    const { sessions } = open();
    const { id } = sessions.start('webm', { mic: true });
    const done = await sessions.stop(id);

    expect(existsSync(done.micTrackPath!)).toBe(true);
    expect(readFileSync(done.micTrackPath!).length).toBe(0);
    expect(() => sessions.appendMicAudio(id, new Uint8Array([1]))).toThrow(/not recording/);
  });

  it('is served for Replay with byte ranges, like the Desktop Track', async () => {
    const { sessions } = open();
    const { id } = sessions.start('webm', { mic: true });
    sessions.appendMicAudio(id, new Uint8Array([4, 5, 6, 7]));
    await sessions.stop(id);

    const part = audioFileResponse(sessions.micTrackPath(id)!, 'bytes=1-2');
    expect(part.status).toBe(206);
    expect(part.headers.get('Content-Type')).toBe('audio/webm');
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([5, 6]);
    expect(sessions.micTrackPath(999)).toBeUndefined();
  });

  it('survives reopening the app, and Sessions stored before it have none', async () => {
    let { sessions } = open();
    const { id } = sessions.start('webm', { mic: true });
    await sessions.stop(id);
    app!.close();

    // A database from before the Mic Track: sessions without the column.
    const oldDir = mkdtempSync(join(tmpdir(), 'ill-mic-old-'));
    try {
      const db = new DatabaseSync(join(oldDir, 'app.db'));
      db.exec(`CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL,
        ended_at TEXT, status TEXT NOT NULL, desktop_track_path TEXT NOT NULL);
        INSERT INTO sessions (started_at, ended_at, status, desktop_track_path)
        VALUES ('2026-01-01T10:00:00.000Z', '2026-01-01T10:05:00.000Z', 'completed', 'old.webm');`);
      db.close();
      const old = createApp({
        dataDir: oldDir,
        providers: {
          speechToText: new FakeSpeechToText([]),
          translator: new FakeTranslator(),
          arabicAnalyzer: new FakeArabicAnalyzer(),
          dictionary: new FakeDictionary({}),
        },
      });
      expect(old.sessions.list().map((s) => s.micTrackPath)).toEqual([null]);
      old.close();
    } finally {
      rmSync(oldDir, { recursive: true, force: true });
    }

    ({ sessions } = open());
    expect(sessions.list().find((s) => s.id === id)?.micTrackPath).toMatch(/-mic\.webm$/);
  });
});
