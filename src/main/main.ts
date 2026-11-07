import { app, BrowserWindow, desktopCapturer, ipcMain, session } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createApp, type App } from '../core/app';
import { CamelArabicAnalyzer, camelHelperCommand } from '../core/analysis/camel';
import { readDetailModuleConfig } from '../core/details/wordDetails';
import { SqliteDictionary } from '../core/dictionary/sqlite';
import type { ArabicAnalyzer, Dictionary, SpeechToText, Translator } from '../core/providers';
import { DeepgramSpeechToText } from '../core/stt/deepgram';
import { SonioxSpeechToText } from '../core/stt/soniox';
import { GoogleTranslator } from '../core/translation/google';
import {
  FakeArabicAnalyzer,
  FakeDictionary,
  FakeSpeechToText,
  FakeTranslator,
} from '../core/fakes';

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

/** Google Cloud Translation (GLOSSARY, Sentence translation); without a key, no translations. */
function translatorFromEnv(env: NodeJS.ProcessEnv): Translator {
  if (env.GOOGLE_TRANSLATE_API_KEY) return new GoogleTranslator({ apiKey: env.GOOGLE_TRANSLATE_API_KEY });
  console.warn('No GOOGLE_TRANSLATE_API_KEY set: Utterances show without a sentence translation.');
  return new FakeTranslator();
}

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
function dictionaryFromBundle(): Dictionary {
  const path = app.isPackaged
    ? join(process.resourcesPath, 'dictionary', 'dictionary.db')
    : join(app.getAppPath(), 'vendor', 'dictionary', 'dictionary.db');
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

function registerIpc({ sessions, vocabulary, words }: App): void {
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
  ipcMain.handle('vocabulary:list', () => vocabulary.list());
  ipcMain.handle('words:details', async (_event, lemmaId: unknown, surface: unknown) =>
    (await words.details(requireLemmaId(lemmaId), optionalSurface(surface))) ?? null,
  );
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

/**
 * Dev and `npm start` read API keys from a git-ignored `.env` at the repo root (see
 * .env.example). Variables already set in the environment win. Packaged builds never
 * read it; keys there come from the settings screen (#13).
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
    // Until the settings screen (#13), the word panel's modules are set in this file.
    detailModules: readDetailModuleConfig(join(dataDir, 'detail-modules.json')),
    providers: {
      speechToText: speechToTextFromEnv(process.env),
      translator: translatorFromEnv(process.env),
      arabicAnalyzer: arabicAnalyzerFromBundle(),
      dictionary: dictionaryFromBundle(),
    },
  });
  registerIpc(core);
  allowDesktopAudioCapture();
  createWindow();
});

app.on('window-all-closed', () => {
  // Complete any Session still recording before the database closes.
  // The helper shuts down with the app.
  void (core?.sessions.stopAll() ?? Promise.resolve())
    .then(() => analyzer?.close())
    .finally(() => {
      core?.close();
      dictionary?.close();
      app.quit();
    });
});
