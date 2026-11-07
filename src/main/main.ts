import { app, BrowserWindow, desktopCapturer, ipcMain, session } from 'electron';
import { join } from 'node:path';
import { createApp } from '../core/app';
import {
  FakeArabicAnalyzer,
  FakeDictionary,
  FakeSpeechToText,
  FakeTranslator,
} from '../core/fakes';

// Walking skeleton: the real Deepgram, Google and CAMeL adapters arrive in later tickets,
// so the app runs on the fake providers for now. Audio recording is real.
const core = () =>
  createApp({
    dataDir: app.getPath('userData'),
    providers: {
      speechToText: new FakeSpeechToText([]),
      translator: new FakeTranslator(),
      arabicAnalyzer: new FakeArabicAnalyzer(),
      dictionary: new FakeDictionary(),
    },
  });

let ilApp: ReturnType<typeof core>;

const MAX_CHUNK_BYTES = 16 * 1024 * 1024;

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

function registerIpc(): void {
  ipcMain.handle('sessions:start', () => ilApp.sessions.start());
  ipcMain.handle('sessions:append', (_event, sessionId: unknown, chunk: unknown) => {
    ilApp.sessions.appendDesktopAudio(
      requireSessionId(sessionId),
      requireChunk(chunk),
    );
  });
  ipcMain.handle('sessions:stop', (_event, sessionId: unknown) =>
    ilApp.sessions.stop(requireSessionId(sessionId)),
  );
  ipcMain.handle('sessions:list', () => ilApp.sessions.list());
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 650,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  ilApp = core();
  registerIpc();

  // Capture Windows system (loopback) audio. getDisplayMedia needs a video source to be
  // granted; the renderer discards the video track and records only the audio.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  ilApp?.close();
  if (process.platform !== 'darwin') app.quit();
});
