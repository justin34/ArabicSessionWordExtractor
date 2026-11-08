// GLOSSARY: Installer. A packaged build never stands in fakes for its helper or dictionary.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CamelArabicAnalyzer, camelHelperCommand } from '../src/core/analysis/camel';
import { createApp, type App } from '../src/core/app';
import {
  analyzerFallback,
  checkBundle,
  dictionaryFallback,
  UnavailableArabicAnalyzer,
  UnavailableDictionary,
} from '../src/core/bundle';
import { SqliteDictionary } from '../src/core/dictionary/sqlite';
import { FakeArabicAnalyzer, FakeDictionary, FakeSpeechToText, FakeTranslator } from '../src/core/fakes';
import type { ArabicAnalyzer, Dictionary } from '../src/core/providers';

const dirs: string[] = [];
let app: App | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('A missing or broken helper or dictionary', () => {
  it('stands in the fakes in development runs, and tells the learner nothing', () => {
    const analysis = analyzerFallback(false);
    const dictionary = dictionaryFallback(false);
    expect(analysis.provider).toBeInstanceOf(FakeArabicAnalyzer);
    expect(dictionary.provider).toBeInstanceOf(FakeDictionary);
    expect(analysis.problem).toBeUndefined();
    expect(dictionary.problem).toBeUndefined();
  });

  it('never stands in fakes in a packaged build: it says what is unavailable and to reinstall', () => {
    const analysis = analyzerFallback(true);
    const dictionary = dictionaryFallback(true);
    expect(analysis.provider).toBeInstanceOf(UnavailableArabicAnalyzer);
    expect(dictionary.provider).toBeInstanceOf(UnavailableDictionary);
    expect(analysis.problem?.message).toMatch(/^Word analysis is unavailable.*Recording still works\. Reinstall Arabic Session Word Extractor/);
    expect(dictionary.problem?.message).toMatch(/^The dictionary is unavailable.*Reinstall Arabic Session Word Extractor/);
  });

  it('records a packaged build’s Session as usual, its Utterances unanalyzed and nothing in the Vocabulary', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'bundle-'));
    dirs.push(dataDir);
    app = createApp({
      dataDir,
      translationWaitMs: 0,
      providers: {
        speechToText: new FakeSpeechToText([
          { type: 'final', text: 'ذهب الطالب', startMs: 0, endMs: 900, words: [
            { text: 'ذهب', startMs: 0, endMs: 400 },
            { text: 'الطالب', startMs: 400, endMs: 900 },
          ] },
        ]),
        translator: new FakeTranslator(),
        arabicAnalyzer: analyzerFallback(true).provider,
        dictionary: dictionaryFallback(true).provider,
      },
    });
    const { id } = app.sessions.start();
    app.sessions.appendDesktopAudio(id, new Uint8Array([1, 2, 3]));
    const stopped = await app.sessions.stop(id);

    expect(stopped.status).toBe('completed');
    const [utterance] = app.sessions.transcript(id);
    expect(utterance.text).toBe('ذهب الطالب');
    expect(utterance.tokens.every((t) => t.lemmaId === null)).toBe(true);
    expect(app.vocabulary.list()).toEqual([]);
  });
});

describe("The release script's check of a packaged build", () => {
  const analyzer = (lemmas: Record<string, string>): ArabicAnalyzer => new FakeArabicAnalyzer(lemmas);
  const realLemmas = { ذهب: 'ذَهَب', الطالب: 'طالِب', إلى: 'إِلَى', المدرسة: 'مَدْرَسَة' };
  const dictionary: Dictionary = new FakeDictionary({ كِتَاب: ['book'] });

  it('passes when the helper analyzes the sentence and the dictionary answers', async () => {
    expect(await checkBundle(analyzer(realLemmas), dictionary)).toEqual({ analysis: null, dictionary: null });
  });

  it('fails a helper that does not answer, or one that analyzes like the fake', async () => {
    expect((await checkBundle(new UnavailableArabicAnalyzer(), dictionary)).analysis).toMatch(/did not analyze a sentence/);
    expect((await checkBundle(analyzer({}), dictionary)).analysis).toMatch(/analysis looks wrong/);
    const hung: ArabicAnalyzer = { analyze: () => new Promise(() => {}) };
    expect((await checkBundle(hung, dictionary, { timeoutMs: 20 })).analysis).toMatch(/no answer in 20 ms/);
  });

  it('fails a dictionary that does not open, or that is empty', async () => {
    expect((await checkBundle(analyzer(realLemmas), new UnavailableDictionary())).dictionary).toMatch(/did not open/);
    expect((await checkBundle(analyzer(realLemmas), new FakeDictionary())).dictionary).toMatch(/no entry for/);
  });
});

// The same check against the real bundle, when it is built (npm run build:helper, build:dictionary).
const root = join(__dirname, '..');
const helperDir = join(root, 'vendor', 'camel-helper');
const dictionaryPath = join(root, 'vendor', 'dictionary', 'dictionary.db');
const bundled = existsSync(join(helperDir, 'python', 'python.exe')) && existsSync(dictionaryPath);

describe.skipIf(!bundled)('The check against the real bundle', () => {
  let camel: CamelArabicAnalyzer | undefined;
  let sqlite: SqliteDictionary | undefined;
  afterAll(() => {
    camel?.close();
    sqlite?.close();
  });

  it('passes', async () => {
    camel = new CamelArabicAnalyzer({
      helper: camelHelperCommand(helperDir, join(root, 'helper', 'camel', 'analyze.py')),
      log: () => {},
    });
    camel.start();
    sqlite = new SqliteDictionary(dictionaryPath);
    expect(await checkBundle(camel, sqlite)).toEqual({ analysis: null, dictionary: null });
  }, 90_000);
});
