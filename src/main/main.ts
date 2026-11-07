import { app, BrowserWindow, desktopCapturer, ipcMain, session } from 'electron';
import { join } from 'node:path';
import { createApp, type App } from '../core/app';
import type { SpeechToText } from '../core/providers';
import { DeepgramSpeechToText } from '../core/stt/deepgram';
import { SonioxSpeechToText } from '../core/stt/soniox';
import {
  FakeArabicAnalyzer,
  FakeDictionary,
  FakeSpeechToText,
  FakeTranslator,
} from '../core/fakes';

const MAX_CHUNK_BYTES = 16 * 1024 * 1024;

let core: App | undefined;

function requireSessionId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('Invalid session id');
  }
  return value;
}

function requireChunk(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength > MAX_CHUNK_BYTES) {
    throw new Error('Invalid audio chunk');
  }
  return value;
}

/**
 * Soniox first, Deepgram as the fallback (GLOSSARY, STT provider). Keys come from the
 * environment until the settings screen exists; with neither, Transcripts stay empty.
 */
function speechToTextFromEnv(env: NodeJS.ProcessEnv): SpeechToText {
  if (env.SONIOX_API_KEY) return new SonioxSpeechToText({ apiKey: env.SONIOX_API_KEY });
  if (env.DEEPGRAM_API_KEY) return new DeepgramSpeechToText({ apiKey: env.DEEPGRAM_API_KEY });
  console.warn('No SONIOX_API_KEY or DEEPGRAM_API_KEY set: Sessions record without a transcript.');
  return new FakeSpeechToText([]);
}

function registerIpc(sessions: App['sessions']): void {
  // Every window hears every live Session; the renderer picks the one it shows.
  sessions.subscribe((sessionId, update) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('transcript:update', sessionId, update);
    }
  });
  ipcMain.handle('sessions:start', () => sessions.start());
  ipcMain.handle('sessions:appendDesktopAudio', (_event, id: unknown, chunk: unknown) =>
    sessions.appendDesktopAudio(requireSessionId(id), requireChunk(chunk)),
  );
  ipcMain.handle('sessions:stop', (_event, id: unknown) => sessions.stop(requireSessionId(id)));
  ipcMain.handle('sessions:list', () => sessions.list());
}

/** Grants getDisplayMedia the primary screen plus Windows loopback (desktop) audio. */
function allowDesktopAudioCapture(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // In dev (npm run dev) the renderer is served by Vite for hot reload.
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
}

void app.whenReady().then(() => {
  // Real Google and CAMeL adapters arrive in later tickets; until then those run on fakes.
  core = createApp({
    dataDir: app.getPath('userData'),
    providers: {
      speechToText: speechToTextFromEnv(process.env),
      translator: new FakeTranslator(),
      arabicAnalyzer: new FakeArabicAnalyzer(),
      dictionary: new FakeDictionary(),
    },
  });
  registerIpc(core.sessions);
  allowDesktopAudioCapture();
  createWindow();
});

app.on('window-all-closed', () => {
  // Complete any Session still recording before the database closes.
  void (core?.sessions.stopAll() ?? Promise.resolve()).finally(() => {
    core?.close();
    app.quit();
  });
});
