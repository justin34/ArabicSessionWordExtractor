import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, type App, type AppOptions } from '../../src/core/app';
import type { DetailModule } from '../../src/core/details/modules';
import { readDetailModuleConfig } from '../../src/core/details/wordDetails';
import { FakeDictionary, FakeSpeechToText, FakeTranslator } from '../../src/core/fakes';
import type { ArabicAnalyzer, Providers, SttEvent, TokenAnalysis } from '../../src/core/providers';
import type { DetailSection, VocabularyEntry } from '../../src/core/types';

const script: SttEvent[] = [
  {
    type: 'final',
    text: 'كتبوا الدرس',
    startMs: 0,
    endMs: 1000,
    words: [
      { text: 'كتبوا', startMs: 0, endMs: 400 },
      { text: 'الدرس', startMs: 500, endMs: 1000 },
    ],
  },
];

const analyses: Record<string, TokenAnalysis[]> = {
  'كتبوا الدرس': [
    {
      surface: 'كتبوا',
      lemma: 'كَتَب',
      diacritized: 'كَتَبُوا',
      root: 'ك.ت.ب',
      pattern: '1َ2َ3ُوا',
      partOfSpeech: 'verb',
      pronunciation: 'k a t a b uu',
      stemGloss: 'write',
    },
    { surface: 'الدرس', lemma: 'دَرْس', diacritized: 'الدَّرْسَ', root: 'د.ر.س', partOfSpeech: 'noun', stemGloss: 'lesson' },
  ],
  'كتب الطالب': [
    { surface: 'كتب', lemma: 'كَتَب', diacritized: 'كَتَبَ', root: 'ك.ت.ب', partOfSpeech: 'verb', pronunciation: 'k a t a b a' },
    { surface: 'الطالب', lemma: 'طالِب', root: 'ط.ل.ب', partOfSpeech: 'noun' },
  ],
};

const analyzer: ArabicAnalyzer = { analyze: async (sentence) => analyses[sentence] ?? [] };

const dictionary = new FakeDictionary(
  {
    'كَتَب': { definitions: ['to write', 'to compose'], etymology: 'From the root ك ت ب, related to writing.' },
  },
  [
    { arabic: 'كتب الرسالة.', english: 'He wrote the letter.' },
    { arabic: 'هل كتبوا؟', english: 'Did they write?' },
    { arabic: 'أنا طالب.', english: 'I am a student.' },
  ],
);

function providers(overrides: Partial<Providers> = {}): Providers {
  return {
    speechToText: new FakeSpeechToText(script),
    translator: new FakeTranslator({ 'كتبوا الدرس': 'They wrote the lesson.', 'كتب الطالب': 'The student wrote.' }),
    arabicAnalyzer: analyzer,
    dictionary,
    ...overrides,
  };
}

let dir: string;
let app: App | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ill-details-'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  app?.close();
  app = undefined;
  rmSync(dir, { recursive: true, force: true });
});

/** Records the scripted Session (or `sessions` of them) and returns the app and its Vocabulary. */
async function recorded(
  options: Partial<AppOptions> = {},
  sessions: SttEvent[][] = [script],
): Promise<{ app: App; entry: (lemma: string) => VocabularyEntry }> {
  const audio = join(dir, 'class.webm');
  writeFileSync(audio, Buffer.from([1]));
  for (const events of sessions) {
    app?.close();
    app = createApp({
      dataDir: dir,
      ...options,
      providers: providers({ speechToText: new FakeSpeechToText(events), ...options.providers }),
    });
    await app.sessions.processRecording(audio);
    // Word Cards rebuilt at the Session's end run the same modules.
    await app.guides.idle();
  }
  const current = app!;
  return {
    app: current,
    entry: (lemma) => current.vocabulary.list().find((e) => e.lemma === lemma)!,
  };
}

const titles = (sections: DetailSection[] | undefined) => sections?.map((s) => s.title);
const section = (sections: DetailSection[] | undefined, moduleId: string) =>
  sections?.find((s) => s.moduleId === moduleId);

describe('Word panel built from Detail Modules', () => {
  it('shows every built-in module with data, in the default order', async () => {
    const { app, entry } = await recorded();

    const details = await app.words.details(entry('كَتَب').lemmaId, 'كتبوا');

    expect(details?.lemma).toBe('كَتَب');
    expect(titles(details?.sections)).toEqual([
      'Form',
      'Pronunciation',
      'Definitions',
      'Examples',
      'Your examples',
      'Heard in',
    ]);
  });

  it('gives the dictionary form, the form heard, part of speech, root and pattern', async () => {
    const { app, entry } = await recorded();

    const form = section((await app.words.details(entry('كَتَب').lemmaId, 'كتبوا'))?.sections, 'form');

    expect(form?.blocks).toEqual([
      {
        kind: 'facts',
        facts: [
          { label: 'Dictionary form', value: 'كَتَب', arabic: true },
          { label: 'Heard as', value: 'كَتَبُوا', arabic: true },
          { label: 'Part of speech', value: 'verb' },
          { label: 'Root', value: 'ك.ت.ب', arabic: true },
          { label: 'Pattern', value: '1َ2َ3ُوا', arabic: true },
        ],
      },
    ]);
  });

  it('gives the pronunciation of the form clicked', async () => {
    const { app, entry } = await recorded({}, [
      script,
      [{ type: 'final', text: 'كتب الطالب', startMs: 0, endMs: 900, words: [{ text: 'كتب', startMs: 0, endMs: 400 }, { text: 'الطالب', startMs: 450, endMs: 900 }] }],
    ]);
    const id = entry('كَتَب').lemmaId;

    const said = async (surface: string) =>
      section((await app.words.details(id, surface))?.sections, 'pronunciation')?.blocks;

    expect(await said('كتب')).toEqual([
      { kind: 'facts', facts: [{ label: 'Form', value: 'كَتَبَ', arabic: true }, { label: 'Sounds', value: 'k a t a b a' }] },
    ]);
    expect(await said('كتبوا')).toMatchObject([{ facts: [{ value: 'كَتَبُوا' }, { value: 'k a t a b uu' }] }]);
  });

  it('gives full definitions and the etymology from the dictionary, and general examples', async () => {
    const { app, entry } = await recorded();

    const sections = (await app.words.details(entry('كَتَب').lemmaId, 'كتبوا'))?.sections;

    expect(section(sections, 'definitions')?.blocks).toEqual([
      { kind: 'list', ordered: true, items: [{ text: 'to write' }, { text: 'to compose' }] },
      { kind: 'text', heading: 'Etymology', text: 'From the root ك ت ب, related to writing.' },
    ]);
    // Found by the surface form heard, كتبوا; كتب is not one heard for this Lemma.
    expect(section(sections, 'examples')?.blocks).toEqual([
      { kind: 'examples', examples: [{ arabic: 'هل كتبوا؟', english: 'Did they write?' }] },
    ]);
  });

  it("gives the learner's own Utterances and the Sessions the word was heard in", async () => {
    const { app, entry } = await recorded({}, [script, script]);

    const sections = (await app.words.details(entry('دَرْس').lemmaId, 'الدرس'))?.sections;

    const own = section(sections, 'own-examples')?.blocks[0];
    expect(own).toMatchObject({
      kind: 'examples',
      examples: [
        { arabic: 'كتبوا الدرس', english: 'They wrote the lesson.' },
        { arabic: 'كتبوا الدرس', english: 'They wrote the lesson.' },
      ],
    });
    const heardIn = section(sections, 'sessions')?.blocks[0];
    expect(heardIn).toMatchObject({ kind: 'list', items: [{ note: 'heard once' }, { note: 'heard once' }] });
  });

  it('leaves out a module with no data', async () => {
    const { app, entry } = await recorded();

    // دَرْس has no dictionary entry, no pronunciation and no example sentence.
    const details = await app.words.details(entry('دَرْس').lemmaId, 'الدرس');

    expect(titles(details?.sections)).toEqual(['Form', 'Your examples', 'Heard in']);
  });

  it('has no details for a Lemma that is not in the Vocabulary', async () => {
    const { app } = await recorded();

    expect(await app.words.details(9999)).toBeUndefined();
  });
});

describe('Configuring the Detail Modules', () => {
  it('shows only the modules configured, in the configured order', async () => {
    const { app, entry } = await recorded({ detailModules: ['sessions', 'definitions', 'form'] });

    const details = await app.words.details(entry('كَتَب').lemmaId, 'كتبوا');

    expect(titles(details?.sections)).toEqual(['Heard in', 'Definitions', 'Form']);
  });

  it('adds a module of its own alongside the built-in ones', async () => {
    const mnemonic: DetailModule = {
      id: 'mnemonic',
      title: 'Memory aid',
      build: ({ lemma }) => [{ kind: 'text', text: `Think of ${lemma.lemma} as a pen.` }],
    };
    const { app, entry } = await recorded({ detailModules: ['form', mnemonic] });

    const details = await app.words.details(entry('كَتَب').lemmaId);

    expect(titles(details?.sections)).toEqual(['Form', 'Memory aid']);
    expect(details?.sections[1]).toEqual({
      moduleId: 'mnemonic',
      title: 'Memory aid',
      blocks: [{ kind: 'text', text: 'Think of كَتَب as a pen.' }],
    });
  });

  it('skips an unknown or repeated module id', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, entry } = await recorded({ detailModules: ['form', 'conjugation', 'form', 'sessions'] });

    const details = await app.words.details(entry('كَتَب').lemmaId);

    expect(titles(details?.sections)).toEqual(['Form', 'Heard in']);
  });

  it('reads the configured module ids from a JSON file', () => {
    const path = join(dir, 'detail-modules.json');
    expect(readDetailModuleConfig(path)).toBeUndefined();

    writeFileSync(path, JSON.stringify(['definitions', 'form']));
    expect(readDetailModuleConfig(path)).toEqual(['definitions', 'form']);

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeFileSync(path, '{"not": "a list"}');
    expect(readDetailModuleConfig(path)).toBeUndefined();
    writeFileSync(path, 'not json');
    expect(readDetailModuleConfig(path)).toBeUndefined();
  });
});

describe('A failing Detail Module', () => {
  const throwing: DetailModule = {
    id: 'throws',
    title: 'Throws',
    build: () => {
      throw new Error('module bug');
    },
  };
  const rejecting: DetailModule = {
    id: 'rejects',
    title: 'Rejects',
    build: () => Promise.reject(new Error('source offline')),
  };

  it('is left out while the other modules still show', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app, entry } = await recorded({ detailModules: ['form', throwing, 'definitions', rejecting, 'sessions'] });
    // Word Cards built while recording ran the same modules.
    errors.mockClear();

    const details = await app.words.details(entry('كَتَب').lemmaId, 'كتبوا');

    expect(titles(details?.sections)).toEqual(['Form', 'Definitions', 'Heard in']);
    expect(errors).toHaveBeenCalledTimes(2);
  });

  it('is left out when its data source fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = {
      lookup: () => Promise.reject(new Error('dictionary missing')),
      examples: () => Promise.reject(new Error('dictionary missing')),
    };
    const { app, entry } = await recorded({ providers: { ...providers(), dictionary: broken } });

    const details = await app.words.details(entry('كَتَب').lemmaId, 'كتبوا');

    expect(titles(details?.sections)).toEqual(['Form', 'Pronunciation', 'Your examples', 'Heard in']);
  });

  it('is left out when it does not answer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Answers while the Word Cards are built during recording, then stops answering.
    let hang = false;
    const hanging: DetailModule = { id: 'hangs', title: 'Hangs', build: () => (hang ? new Promise(() => {}) : null) };
    const { app, entry } = await recorded({ detailModules: [hanging, 'form'] });
    hang = true;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const pending = app.words.details(entry('كَتَب').lemmaId);
    await vi.advanceTimersByTimeAsync(5000);

    expect(titles((await pending)?.sections)).toEqual(['Form']);
  });
});
