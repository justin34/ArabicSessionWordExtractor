import { app, BrowserWindow, desktopCapturer, ipcMain, protocol, safeStorage, session, shell } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp, type App } from '../core/app';
import { audioFileResponse } from '../core/audioFile';
import { CamelArabicAnalyzer, camelHelperCommand } from '../core/analysis/camel';
import { readDetailModuleConfig } from '../core/details/wordDetails';
import { KeyedSpeechToText, KeyedTranslator } from '../core/apiKeys';
import { isApiKeyName, parseApiKey, parseAudioSettings, type SecretCodec } from '../core/settings';
import { SqliteDictionary } from '../core/dictionary/sqlite';
import type { ArabicAnalyzer, Dictionary } from '../core/providers';
import { FakeArabicAnalyzer, FakeDictionary } from '../core/fakes';

const MAX_CHUNK_BYTES = 16 * 1024 * 1024;

let core: App | undefined;
let analyzer: CamelArabicAnalyzer | undefined;
let dictionary: SqliteDictionary | undefined;

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

const SAFE_PREFIX = 'safe:';

/**
 * API keys in settings.json are encrypted with the operating system's key store (DPAPI on
 * Windows), so the file alone does not give them away. Where that is unavailable they are
 * kept as entered.
 */
const keyCodec: SecretCodec = {
  encode(plain) {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('The system key store is unavailable: API keys are saved unencrypted.');
      return plain;
    }
    return SAFE_PREFIX + safeStorage.encryptString(plain).toString('base64');
  },
  decode(stored) {
    if (!stored.startsWith(SAFE_PREFIX)) return stored;
    return safeStorage.decryptString(Buffer.from(stored.slice(SAFE_PREFIX.length), 'base64'));
  },
};

/**
 * The CAMeL helper bundle (GLOSSARY, Installer size): built into vendor/camel-helper by
 * `npm run build:helper`, and shipped as resources/camel-helper in packaged builds. It is
 * started here, with the app, so its model is loaded before the first sentence.
 */
function arabicAnalyzerFromBundle(): ArabicAnalyzer {
  const bundleDir = app.isPackaged
    ? join(process.resourcesPath, 'camel-helper')
    : join(app.getAppPath(), 'vendor', 'camel-helper');
  const script = app.isPackaged
    ? join(bundleDir, 'analyze.py')
    : join(app.getAppPath(), 'helper', 'camel', 'analyze.py');
  const helper = camelHelperCommand(bundleDir, script);
  if (!existsSync(helper.command)) {
    console.warn(`No Arabic analysis helper in ${bundleDir} (npm run build:helper): words are not analyzed.`);
    return new FakeArabicAnalyzer();
  }
  analyzer = new CamelArabicAnalyzer({ helper });
  analyzer.start();
  return analyzer;
}

/**
 * The bundled dictionary (GLOSSARY, Dictionary plan): built into vendor/dictionary by
 * `npm run build:dictionary`, and shipped as resources/dictionary in packaged builds.
 * Without it, words are glossed by the analyzer's stem gloss alone.
 */
function dictionaryDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'dictionary') : join(app.getAppPath(), 'vendor', 'dictionary');
}

function dictionaryFromBundle(): Dictionary {
  const path = join(dictionaryDir(), 'dictionary.db');
  if (!existsSync(path)) {
    console.warn(`No dictionary at ${path} (npm run build:dictionary): glosses come from the analyzer only.`);
    return new FakeDictionary();
  }
  try {
    dictionary = new SqliteDictionary(path);
    return dictionary;
  } catch (err) {
    console.warn(`Dictionary at ${path} is unusable (${(err as Error).message}): rebuild it.`);
    return new FakeDictionary();
  }
}

function requireLemmaId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('Invalid lemma id');
  }
  return value;
}

function optionalSurface(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 200 ? value : undefined;
}

/** The attribution the dictionary build wrote beside the database, for the Credits screen. */
function dictionaryNotice(): string | null {
  const path = join(dictionaryDir(), 'NOTICE.txt');
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
}

function requireKeyName(value: unknown) {
  if (!isApiKeyName(value)) throw new Error('Unknown API key');
  return value;
}

function registerIpc({ sessions, vocabulary, words, guides, settings, apiKeys }: App): void {
  // Every window hears every live Session; the renderer picks the one it shows.
  sessions.subscribe((sessionId, update) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('transcript:update', sessionId, update);
    }
  });
  sessions.subscribeTranscriptionFailures((sessionId, message) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('transcript:failed', sessionId, message);
    }
  });
  ipcMain.handle('sessions:transcriptionFailure', (_event, id: unknown) =>
    sessions.transcriptionFailure(requireSessionId(id)) ?? null,
  );
  // Keys go in, never back out: the renderer sees only whether each is set.
  ipcMain.handle('settings:apiKeys', () => apiKeys.status());
  ipcMain.handle('settings:setApiKey', (_event, name: unknown, value: unknown) => {
    const key = parseApiKey(value);
    if (key === undefined) throw new Error('That does not look like an API key: paste it without spaces.');
    return apiKeys.set(requireKeyName(name), key);
  });
  ipcMain.handle('settings:checkApiKey', (_event, name: unknown) => apiKeys.check(requireKeyName(name)));
  ipcMain.handle('credits:dictionaryNotice', () => dictionaryNotice());
  ipcMain.handle('sessions:start', (_event, options: unknown) =>
    sessions.start('webm', { mic: (options as { mic?: unknown } | undefined)?.mic === true }),
  );
  ipcMain.handle('sessions:appendDesktopAudio', (_event, id: unknown, chunk: unknown) =>
    sessions.appendDesktopAudio(requireSessionId(id), requireChunk(chunk)),
  );
  ipcMain.handle('sessions:appendMicAudio', (_event, id: unknown, chunk: unknown) =>
    sessions.appendMicAudio(requireSessionId(id), requireChunk(chunk)),
  );
  ipcMain.handle('sessions:stop', (_event, id: unknown) => sessions.stop(requireSessionId(id)));
  ipcMain.handle('sessions:list', () => sessions.list());
  ipcMain.handle('sessions:transcript', (_event, id: unknown) => sessions.transcript(requireSessionId(id)));
  ipcMain.handle('vocabulary:list', () => vocabulary.list());
  ipcMain.handle('words:details', async (_event, lemmaId: unknown, surface: unknown) =>
    (await words.details(requireLemmaId(lemmaId), optionalSurface(surface))) ?? null,
  );
  ipcMain.handle('guides:wordCard', (_event, lemmaId: unknown) => guides.wordCard(requireLemmaId(lemmaId)) ?? null);
  ipcMain.handle('settings:audio', () => settings.audio());
  ipcMain.handle('settings:setAudio', (_event, value: unknown) => {
    const audio = parseAudioSettings(value);
    if (!audio) throw new Error('Invalid audio settings');
    return settings.setAudio(audio);
  });
  ipcMain.handle(
    'guides:sessionGuide',
    (_event, id: unknown) => guides.sessionGuide(requireSessionId(id)) ?? null,
  );
}

/**
 * Replay reads Session audio from `session-audio://desktop/<id>` and `session-audio://mic/<id>`:
 * only the Desktop and Mic Tracks of stored Sessions, never an arbitrary path. Ranges are
 * honoured so the player can seek.
 */
const AUDIO_SCHEME = 'session-audio';
protocol.registerSchemesAsPrivileged([
  { scheme: AUDIO_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

function serveSessionAudio({ sessions }: App): void {
  protocol.handle(AUDIO_SCHEME, (request) => {
    const url = new URL(request.url);
    const id = Number(url.pathname.replace(/^\//, ''));
    const valid = Number.isInteger(id) && id > 0;
    const path = !valid
      ? undefined
      : url.hostname === 'desktop'
        ? sessions.desktopTrackPath(id)
        : url.hostname === 'mic'
          ? sessions.micTrackPath(id)
          : undefined;
    if (!path) return new Response('No such track', { status: 404 });
    return audioFileResponse(path, request.headers.get('range'));
  });
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
  // Links (the Credits screen's) open in the system browser; the window never leaves the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    // The app's own pages (file://, or the Vite dev server) load as usual.
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (!/^https?:\/\//.test(url) || (devUrl && url.startsWith(devUrl))) return;
    event.preventDefault();
    if (url.startsWith('https://')) void shell.openExternal(url);
  });
  // In dev (npm run dev) the renderer is served by Vite for hot reload.
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
}

/**
 * Dev and `npm start` read API keys from a git-ignored `.env` at the repo root (see
 * .env.example). Variables already set in the environment win over it, and keys entered
 * on the settings screen win over both. Packaged builds never read it.
 */
function loadDevEnvFile(): void {
  if (app.isPackaged) return;
  const path = join(app.getAppPath(), '.env');
  if (existsSync(path)) process.loadEnvFile(path);
}

void app.whenReady().then(() => {
  loadDevEnvFile();
  const dataDir = app.getPath('userData');
  core = createApp({
    dataDir,
    secrets: keyCodec,
    // Keys entered in Settings win; environment variables (or the dev .env) fill in.
    keys: { env: process.env },
    // The word panel's modules are set in this file; they are not on the settings screen yet.
    detailModules: readDetailModuleConfig(join(dataDir, 'detail-modules.json')),
    providers: (keys) => ({
      speechToText: new KeyedSpeechToText(keys),
      translator: new KeyedTranslator(keys),
      arabicAnalyzer: arabicAnalyzerFromBundle(),
      dictionary: dictionaryFromBundle(),
    }),
  });
  registerIpc(core);
  serveSessionAudio(core);
  allowDesktopAudioCapture();
  createWindow();
});

app.on('window-all-closed', () => {
  // Complete any Session still recording before the database closes.
  // The helper shuts down with the app.
  // Word Cards being rebuilt are finished first, too.
  void (core?.sessions.stopAll() ?? Promise.resolve())
    .then(() => core?.guides.idle())
    .then(() => analyzer?.close())
    .finally(() => {
      core?.close();
      dictionary?.close();
      app.quit();
    });
});
