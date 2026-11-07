import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, type App } from '../src/core/app';
import {
  FakeSpeechToText,
  FakeTranslator,
  FakeArabicAnalyzer,
  FakeDictionary,
} from '../src/core/fakes';

let dir: string;
let app: App;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ill-'));
  app = createApp({
    dataDir: dir,
    providers: {
      speechToText: new FakeSpeechToText([
        { type: 'interim', text: 'مر', startMs: 0, endMs: 300 },
        { type: 'final', text: 'مرحبا بكم', startMs: 0, endMs: 1200 },
        { type: 'final', text: 'كيف حالكم', startMs: 1300, endMs: 2400 },
      ]),
      translator: new FakeTranslator({ 'مرحبا بكم': 'Welcome', 'كيف حالكم': 'How are you all' }),
      arabicAnalyzer: new FakeArabicAnalyzer(),
      dictionary: new FakeDictionary(),
    },
  });
});

afterEach(() => {
  app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('Session pipeline', () => {
  it('turns a recorded audio file into a stored Session with a translated Transcript', async () => {
    const audio = join(dir, 'class.webm');
    writeFileSync(audio, Buffer.from([1, 2, 3, 4, 5]));

    const sessionId = await app.sessions.processRecording(audio);

    const sessions = app.sessions.list();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(sessionId);
    expect(sessions[0].status).toBe('completed');
    expect(existsSync(sessions[0].desktopTrackPath)).toBe(true);
    expect([...readFileSync(sessions[0].desktopTrackPath)]).toEqual([1, 2, 3, 4, 5]);

    const transcript = app.sessions.getTranscript(sessionId);
    expect(transcript.map((u) => u.text)).toEqual(['مرحبا بكم', 'كيف حالكم']);
    expect(transcript.map((u) => u.translation)).toEqual(['Welcome', 'How are you all']);
    expect(transcript[1].startMs).toBe(1300);
  });

  it('does not store interim results as Utterances', async () => {
    const audio = join(dir, 'a.webm');
    writeFileSync(audio, Buffer.from([9]));
    const id = await app.sessions.processRecording(audio);
    expect(app.sessions.getTranscript(id)).toHaveLength(2);
  });
});

describe('Live recording lifecycle', () => {
  it('start, append desktop audio chunks, stop: saves the Desktop Track and completes the Session', () => {
    const session = app.sessions.start();
    expect(session.status).toBe('recording');

    app.sessions.appendDesktopAudio(session.id, new Uint8Array([1, 2]));
    app.sessions.appendDesktopAudio(session.id, new Uint8Array([3]));
    const done = app.sessions.stop(session.id);

    expect(done.status).toBe('completed');
    expect(done.endedAt).not.toBeNull();
    expect([...readFileSync(done.desktopTrackPath)]).toEqual([1, 2, 3]);
    expect(app.sessions.list().map((s) => s.id)).toEqual([session.id]);
  });

  it('lists newest Session first', () => {
    const a = app.sessions.start();
    app.sessions.stop(a.id);
    const b = app.sessions.start();
    app.sessions.stop(b.id);
    expect(app.sessions.list().map((s) => s.id)).toEqual([b.id, a.id]);
  });

  it('rejects audio for a Session that is not recording', () => {
    const s = app.sessions.start();
    app.sessions.stop(s.id);
    expect(() => app.sessions.appendDesktopAudio(s.id, new Uint8Array([1]))).toThrow();
  });
});

describe('Provider interfaces', () => {
  it('exposes the four providers the pipeline is built on', () => {
    expect(Object.keys(app.providers).sort()).toEqual([
      'arabicAnalyzer',
      'dictionary',
      'speechToText',
      'translator',
    ]);
  });
});
