/**
 * The bundled CAMeL helper and dictionary (GLOSSARY: Installer). A development run without
 * them stands in the fakes, so the app still runs before `npm run build:helper` or
 * `npm run build:dictionary`. A packaged build never does: fake analysis would fill the
 * learner's Vocabulary with every surface form as its own Lemma. Instead it says what is
 * unavailable and to reinstall, and recording carries on (GLOSSARY: Resilience).
 */
import { APP_NAME } from './appIdentity';
import { FakeArabicAnalyzer, FakeDictionary } from './fakes';
import type { ArabicAnalyzer, Dictionary, DictionaryEntry, ExampleSentence, TokenAnalysis } from './providers';
import type { BundleProblem } from './types';

export const BUNDLE_PROBLEMS: Record<BundleProblem['part'], BundleProblem> = {
  analysis: {
    part: 'analysis',
    message: `Word analysis is unavailable: the app's Arabic analysis helper is missing or broken, so words get no Lemmas or glosses. Recording still works. Reinstall ${APP_NAME} to fix it.`,
  },
  dictionary: {
    part: 'dictionary',
    message: `The dictionary is unavailable: it is missing or broken, so words get no definitions or examples. Recording still works. Reinstall ${APP_NAME} to fix it.`,
  },
};

/** Fails every sentence, so its Utterance is stored unanalyzed, as when the helper fails. */
export class UnavailableArabicAnalyzer implements ArabicAnalyzer {
  async analyze(): Promise<TokenAnalysis[]> {
    throw new Error('Word analysis is unavailable');
  }
}

/** Fails every lookup, so a gloss falls back to the stem gloss and dictionary modules are left out. */
export class UnavailableDictionary implements Dictionary {
  async lookup(): Promise<DictionaryEntry | undefined> {
    throw new Error('The dictionary is unavailable');
  }

  async examples(): Promise<ExampleSentence[]> {
    throw new Error('The dictionary is unavailable');
  }
}

/** What runs in place of a missing or broken bundled part, and what the learner is told. */
export interface Fallback<T> {
  provider: T;
  /** Only for packaged builds; development runs log instead. */
  problem?: BundleProblem;
}

export function analyzerFallback(packaged: boolean): Fallback<ArabicAnalyzer> {
  return packaged
    ? { provider: new UnavailableArabicAnalyzer(), problem: BUNDLE_PROBLEMS.analysis }
    : { provider: new FakeArabicAnalyzer() };
}

export function dictionaryFallback(packaged: boolean): Fallback<Dictionary> {
  return packaged
    ? { provider: new UnavailableDictionary(), problem: BUNDLE_PROBLEMS.dictionary }
    : { provider: new FakeDictionary() };
}

/** The release script's check of a packaged build: a failure message per part, or none. */
export interface BundleCheck {
  analysis: string | null;
  dictionary: string | null;
}

/** A sentence every working helper analyzes into these Lemmas' words. */
export const CHECK_SENTENCE = 'ذهب الطالب إلى المدرسة';
/** A word every built dictionary has. */
export const CHECK_LEMMA = 'كِتَاب';

/**
 * Checks that the helper really analyzes a sentence (each word gets a Lemma) and that the
 * dictionary opens and answers a lookup. Each check gets `timeoutMs`.
 */
export async function checkBundle(
  analyzer: ArabicAnalyzer,
  dictionary: Dictionary,
  { timeoutMs = 60_000 }: { timeoutMs?: number } = {},
): Promise<BundleCheck> {
  const within = <T>(work: Promise<T>) =>
    Promise.race([
      work,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no answer in ${timeoutMs} ms`)), timeoutMs).unref?.()),
    ]);
  const analysis = await within(analyzer.analyze(CHECK_SENTENCE)).then(
    (tokens) =>
      tokens.length === CHECK_SENTENCE.split(' ').length && tokens.every((t) => t.lemma && t.lemma !== t.surface)
        ? null
        : `the helper's analysis looks wrong: ${JSON.stringify(tokens.map((t) => [t.surface, t.lemma]))}`,
    (err: Error) => `the helper did not analyze a sentence: ${err.message}`,
  );
  const dictionaryResult = await within(dictionary.lookup(CHECK_LEMMA, 'noun')).then(
    (entry) => (entry && entry.definitions.length > 0 ? null : `the dictionary has no entry for ${CHECK_LEMMA}`),
    (err: Error) => `the dictionary did not open: ${err.message}`,
  );
  return { analysis, dictionary: dictionaryResult };
}
