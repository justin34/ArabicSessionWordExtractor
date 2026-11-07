import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, type App } from '../src/core/app';
import { audioFileResponse } from '../src/core/audioFile';
import { FakeArabicAnalyzer, FakeDictionary, FakeSpeechToText, FakeTranslator } from '../src/core/fakes';
import type { SttEvent } from '../src/core/providers';
import { replayPosition } from '../src/renderer/replay';

// Two sentences with a pause between them, and a pause between the words of the second.
const script: SttEvent[] = [
  {
    type: 'final',
    text: 'مرحبا بكم',
    startMs: 0,
    endMs: 1200,
    words: [
      { text: 'مرحبا', startMs: 100, endMs: 600 },
      { text: 'بكم', startMs: 650, endMs: 1150 },
    ],
  },
  {
    type: 'final',
    text: 'كيف حال iPhone',
    startMs: 2000,
    endMs: 4000,
    words: [
      { text: 'كيف', startMs: 2000, endMs: 2400 },
      { text: 'حال', startMs: 3000, endMs: 3400 },
      { text: 'iPhone', startMs: 3500, endMs: 3900 },
    ],
  },
];

let dir: string;
let app: App | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ill-replay-'));
  app = createApp({
    dataDir: dir,
    providers: {
      speechToText: new FakeSpeechToText(script),
      translator: new FakeTranslator(),
      arabicAnalyzer: new FakeArabicAnalyzer(),
      dictionary: new FakeDictionary({}),
    },
  });
});

afterEach(() => {
  app?.close();
  app = undefined;
  rmSync(dir, { recursive: true, force: true });
});

async function finishedSession(bytes = [1, 2, 3, 4, 5, 6, 7, 8]) {
  const path = join(dir, 'class.webm');
  writeFileSync(path, Buffer.from(bytes));
  return app!.sessions.processRecording(path);
}

/** The Token Replay highlights at a playback position, as its surface form. */
function heardAt(transcript: ReturnType<App['sessions']['transcript']>, ms: number): string | null {
  const p = replayPosition(transcript, ms);
  return p && p.token !== null ? transcript[p.utterance].tokens[p.token].surface : null;
}

describe('Replay of a finished Transcript', () => {
  it('highlights the word being heard at a playback position', async () => {
    const session = await finishedSession();
    const transcript = app!.sessions.transcript(session.id);

    expect(heardAt(transcript, 100)).toBe('مرحبا');
    expect(heardAt(transcript, 599)).toBe('مرحبا');
    expect(heardAt(transcript, 650)).toBe('بكم');
    expect(heardAt(transcript, 2100)).toBe('كيف');
    // A Foreign word is highlighted like any other.
    expect(heardAt(transcript, 3600)).toBe('iPhone');
  });

  it('keeps the last word lit through a pause inside a sentence, and nothing between sentences', async () => {
    const session = await finishedSession();
    const transcript = app!.sessions.transcript(session.id);

    expect(heardAt(transcript, 2700)).toBe('كيف');
    expect(replayPosition(transcript, 1500)).toBeNull();
    expect(replayPosition(transcript, 4000)).toBeNull();
  });

  it('marks the sentence but no word before its first word starts', async () => {
    const session = await finishedSession();
    const transcript = app!.sessions.transcript(session.id);

    expect(replayPosition(transcript, 50)).toEqual({ utterance: 0, token: null });
  });
});

describe('Desktop Track served for Replay', () => {
  it('serves the whole recorded file, or the byte range the player asks for', async () => {
    const session = await finishedSession([1, 2, 3, 4, 5, 6, 7, 8]);
    const path = app!.sessions.desktopTrackPath(session.id)!;

    const whole = audioFileResponse(path, null);
    expect(whole.status).toBe(200);
    expect(whole.headers.get('Content-Type')).toBe('audio/webm');
    expect(whole.headers.get('Accept-Ranges')).toBe('bytes');
    expect([...new Uint8Array(await whole.arrayBuffer())]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const part = audioFileResponse(path, 'bytes=2-4');
    expect(part.status).toBe(206);
    expect(part.headers.get('Content-Range')).toBe('bytes 2-4/8');
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([3, 4, 5]);

    const rest = audioFileResponse(path, 'bytes=6-');
    expect([...new Uint8Array(await rest.arrayBuffer())]).toEqual([7, 8]);

    const tail = audioFileResponse(path, 'bytes=-3');
    expect([...new Uint8Array(await tail.arrayBuffer())]).toEqual([6, 7, 8]);
  });

  it('refuses a range past the end, and a Session or file that does not exist', async () => {
    const session = await finishedSession([1, 2]);
    const path = app!.sessions.desktopTrackPath(session.id)!;

    const past = audioFileResponse(path, 'bytes=5-');
    expect(past.status).toBe(416);
    expect(past.headers.get('Content-Range')).toBe('bytes */2');

    expect(app!.sessions.desktopTrackPath(999)).toBeUndefined();
    expect(audioFileResponse(join(dir, 'missing.webm'), null).status).toBe(404);
  });
});
