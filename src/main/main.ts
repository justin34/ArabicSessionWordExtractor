import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, protocol, safeStorage, session, shell } from 'electron';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { autoUpdater } from 'electron-updater';
import { createApp, type App } from '../core/app';
import { audioFileResponse } from '../core/audioFile';
import { CamelArabicAnalyzer, camelHelperCommand } from '../core/analysis/camel';
import { readDetailModuleConfig } from '../core/details/wordDetails';
import { KeyedSpeechToText, KeyedTranslator } from '../core/apiKeys';
import { isApiKeyName, parseApiKey, parseAudioSettings, type SecretCodec } from '../core/settings';
import { SqliteDictionary } from '../core/dictionary/sqlite';
import type { ArabicAnalyzer, Dictionary } from '../core/providers';
import { DEV_DATA_FOLDER } from '../core/appIdentity';
import { analyzerFallback, checkBundle, dictionaryFallback, type Fallback } from '../core/bundle';
import type { AnkiExportResult, AnkiExportTarget, BundleProblem, ReadyUpdate } from '../core/types';

const MAX_CHUNK_BYTES = 16 * 1024 * 1024;

let core: App | undefined;
let analyzer: CamelArabicAnalyzer | undefined;
let dictionary: SqliteDictionary | undefined;
/** Bundled parts a packaged build is missing, told to the learner (GLOSSARY: Installer). */
const bundleProblems: BundleProblem[] = [];
/** The update downloaded in the background, once there is one. */
let readyUpdate: ReadyUpdate | null = null;

/**
 * `--self-check=<file>`: the release script launches the packaged build this way. It checks
 * the bundled helper and dictionary, writes the result to <file> as JSON and exits, without
 * a window or the learner's data.
 */
const selfCheckFile = process.argv.find((a) => a.startsWith('--self-check='))?.slice('--self-check='.length);

if (selfCheckFile) {
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'self-check-')));
} else if (!app.isPackaged) {
  // Development runs keep their own data folder, apart from a packaged build's.
  app.setPath('userData', join(app.getPath('appData'), DEV_DATA_FOLDER));
}

function fallBack<T>(fallback: Fallback<T>): T {
  if (fallback.problem) bundleProblems.push(fallback.problem);
  return fallback.provider;
}

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
    return fallBack(analyzerFallback(app.isPackaged));
  }
  analyzer = new CamelArabicAnalyzer({ helper });
  analyzer.start();
  return analyzer;
}

/**
 * The bundled dictionary (GLOSSARY, Dictionary plan): built into vendor/dictionary by
 * `npm run build:dictionary`, and shipped as resources/dictionary in packaged builds.
 * Without it, words are glossed by the analyzer's stem gloss alone; a packaged build also says so.
 */
function dictionaryDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'dictionary') : join(app.getAppPath(), 'vendor', 'dictionary');
}

function dictionaryFromBundle(): Dictionary {
  const path = join(dictionaryDir(), 'dictionary.db');
  if (!existsSync(path)) {
    console.warn(`No dictionary at ${path} (npm run build:dictionary): glosses come from the analyzer only.`);
    return fallBack(dictionaryFallback(app.isPackaged));
  }
  try {
    dictionary = new SqliteDictionary(path);
    return dictionary;
  } catch (err) {
    console.warn(`Dictionary at ${path} is unusable (${(err as Error).message}): rebuild it.`);
    return fallBack(dictionaryFallback(app.isPackaged));
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

function requireExportTarget(value: unknown): AnkiExportTarget {
  const target = value as { kind?: unknown; sessionId?: unknown } | null;
  if (target?.kind === 'vocabulary') return { kind: 'vocabulary' };
  if (target?.kind === 'session') return { kind: 'session', sessionId: requireSessionId(target.sessionId) };
  throw new Error('Invalid export');
}

/** The Arabic font Anki cards show the Lemma in: the renderer's own copy. */
function ankiFontPath(): string {
  const file = 'NotoNaskhArabic-Regular.woff2';
  return app.isPackaged
    ? join(process.resourcesPath, 'fonts', file)
    : join(app.getAppPath(), 'src', 'renderer', 'fonts', file);
}

/** Files this run exported; "Show in folder" reveals only these. */
const exportedFiles = new Set<string>();

function requireKeyName(value: unknown) {
  if (!isApiKeyName(value)) throw new Error('Unknown API key');
  return value;
}

function registerIpc({ sessions, vocabulary, words, guides, anki, settings, apiKeys }: App): void {
  // Every window hears every live Session; the renderer picks the one it shows.
  sessions.subscribe((sessionId, update) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('transcript:update', sessionId, update);
    }
  });
  sessions.subscribeTranscriptionFailures((sessionId, message, track) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('transcript:failed', sessionId, message, track);
    }
  });
  ipcMain.handle('sessions:transcriptionFailure', (_event, id: unknown, track: unknown) =>
    sessions.transcriptionFailure(requireSessionId(id), track === 'mic' ? 'mic' : 'desktop') ?? null,
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
  ipcMain.handle('app:bundleProblems', () => bundleProblems);
  ipcMain.handle('update:ready', () => readyUpdate);
  // The renderer hides "Restart to update" while recording; this refuses it then too.
  ipcMain.handle('update:restart', () => {
    if (!readyUpdate) throw new Error('No update is ready');
    if (sessions.list().some((s) => s.status === 'recording')) {
      throw new Error('Stop the Session that is recording first.');
    }
    void shutDown().finally(() => autoUpdater.quitAndInstall());
  });
  ipcMain.handle('sessions:start', (_event, options: unknown) => {
    const o = options as { mic?: unknown; transcribeMic?: unknown } | undefined;
    const mic = o?.mic === true;
    return sessions.start('webm', { mic, transcribeMic: mic && o?.transcribeMic === true });
  });
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
  // The learner picks where the deck goes; null when they cancel the Save dialog.
  ipcMain.handle('anki:export', async (event, value: unknown): Promise<AnkiExportResult | null> => {
    const target = requireExportTarget(value);
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Export to Anki',
      defaultPath: join(app.getPath('documents'), anki.defaultFileName(target)),
      filters: [{ name: 'Anki deck', extensions: ['apkg'] }],
    };
    const choice = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (choice.canceled || !choice.filePath) return null;
    const path = resolve(choice.filePath);
    const count = await anki.export(target, path);
    exportedFiles.add(path);
    return { count, path };
  });
  ipcMain.handle('anki:showInFolder', (_event, value: unknown) => {
    if (typeof value !== 'string' || !exportedFiles.has(value)) throw new Error('Not an exported file');
    shell.showItemInFolder(value);
  });
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

/**
 * Packaged builds update themselves from GitHub Releases (GLOSSARY: Installer; ADR 0003): a
 * check on launch, a download in the background, then "Restart to update" in the renderer.
 * An update the learner does not restart for installs when the app quits. A failed check
 * or download is only logged.
 */
function checkForUpdates(): void {
  if (!app.isPackaged) return;
  autoUpdater.logger = console;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (err) => console.warn(`Update failed: ${err.message}`));
  autoUpdater.on('update-downloaded', ({ version }) => {
    readyUpdate = { version };
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('update:downloaded', readyUpdate);
  });
  autoUpdater.checkForUpdates().catch((err: Error) => console.warn(`Update check failed: ${err.message}`));
}

/** The release script's check of a packaged build; see `selfCheckFile`. */
async function runSelfCheck(file: string): Promise<void> {
  let ok = false;
  try {
    const result = await checkBundle(arabicAnalyzerFromBundle(), dictionaryFromBundle());
    ok = bundleProblems.length === 0 && result.analysis === null && result.dictionary === null;
    writeFileSync(file, JSON.stringify({ ok, ...result, problems: bundleProblems.map((p) => p.message) }, null, 2));
  } catch (err) {
    writeFileSync(file, JSON.stringify({ ok: false, error: (err as Error).message }, null, 2));
  } finally {
    analyzer?.close();
    dictionary?.close();
    app.exit(ok ? 0 : 1);
  }
}

void app.whenReady().then(() => {
  if (selfCheckFile) return runSelfCheck(selfCheckFile);
  loadDevEnvFile();
  const dataDir = app.getPath('userData');
  core = createApp({
    dataDir,
    secrets: keyCodec,
    // Keys entered in Settings win; environment variables (or the dev .env) fill in.
    keys: { env: process.env },
    // The word panel's modules are set in this file; they are not on the settings screen yet.
    detailModules: readDetailModuleConfig(join(dataDir, 'detail-modules.json')),
    ankiFontPath: ankiFontPath(),
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
  checkForUpdates();
});

/**
 * Completes any Session still recording before the database closes, and finishes Word
 * Cards being rebuilt. The helper shuts down with the app.
 */
let shuttingDown: Promise<void> | undefined;
function shutDown(): Promise<void> {
  shuttingDown ??= (core?.sessions.stopAll() ?? Promise.resolve())
    .then(() => core?.guides.idle())
    .then(() => analyzer?.close())
    .finally(() => {
      core?.close();
      dictionary?.close();
    });
  return shuttingDown;
}

app.on('window-all-closed', () => {
  if (selfCheckFile) return;
  void shutDown().finally(() => app.quit());
});
