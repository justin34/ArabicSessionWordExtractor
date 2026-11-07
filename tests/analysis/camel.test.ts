// Seam 2 (spec): the real CAMeL helper, real MSA sentences. Needs the helper bundle;
// build it with `npm run build:helper`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { alignToTokens } from '../../src/core/analysis/align';
import { CamelArabicAnalyzer, camelHelperCommand } from '../../src/core/analysis/camel';
import type { TokenAnalysis } from '../../src/core/providers';

const root = join(__dirname, '..', '..');
const bundleDir = join(root, 'vendor', 'camel-helper');
const built = existsSync(join(bundleDir, 'python', 'python.exe'));
if (!built) console.warn('Arabic analysis seam tests skipped: run `npm run build:helper` first.');

let analyzer: CamelArabicAnalyzer;

beforeAll(async () => {
  if (!built) return;
  analyzer = new CamelArabicAnalyzer({
    helper: camelHelperCommand(bundleDir, join(root, 'helper', 'camel', 'analyze.py')),
    log: () => {},
  });
  // Loading the MLE model takes a few seconds.
  await analyzer.analyze('مرحبا');
}, 60_000);

afterAll(() => analyzer?.close());

async function word(sentence: string, surface: string): Promise<TokenAnalysis> {
  const token = (await analyzer.analyze(sentence)).find((t) => t.surface === surface);
  if (!token) throw new Error(`${surface} not in ${sentence}`);
  return token;
}

describe.skipIf(!built)('Arabic analysis by the CAMeL helper', () => {
  it('gives every word its dictionary form, root, part of speech and pronunciation', async () => {
    const tokens = await analyzer.analyze('ذهب الطالب إلى المدرسة');

    expect(tokens.map((t) => [t.surface, t.lemma, t.root, t.partOfSpeech])).toEqual([
      ['ذهب', 'ذَهَب', 'ذ.ه.ب', 'verb'],
      ['الطالب', 'طالِب', 'ط.ل.ب', 'noun'],
      ['إلى', 'إِلَى', '#.ل.#', 'prep'],
      ['المدرسة', 'مَدْرَسَة', 'د.ر.س', 'noun'],
    ]);
    expect(tokens[1]).toMatchObject({
      diacritized: 'الطالِبُ',
      pronunciation: '2_a_t._t._aa_l_i_b_u',
      stemGloss: 'student',
    });
  });

  it('separates attached prefixes and suffixes from the stem', async () => {
    const token = await word('وبكتابهم نتعلم', 'وبكتابهم');

    expect(token.lemma).toBe('كِتاب');
    expect(token.prefixes).toEqual([
      { form: 'وَ', feature: 'wa_part' },
      { form: 'بِ', feature: 'bi_prep' },
    ]);
    expect(token.suffixes).toEqual([{ form: 'هُم', feature: '3mp_poss' }]);
  });

  it('treats the definite article as a prefix, not part of the dictionary form', async () => {
    const token = await word('قرأ الطالب', 'الطالب');

    expect(token.lemma).toBe('طالِب');
    expect(token.prefixes).toEqual([{ form: 'ال', feature: 'Al_det' }]);
    expect(token.suffixes).toEqual([]);
  });

  it('drops punctuation, keeping one analysis per word', async () => {
    const tokens = await analyzer.analyze('مرحبا، كيف حالكم؟');

    expect(tokens.map((t) => t.surface)).toEqual(['مرحبا', 'كيف', 'حالكم']);
  });

  it('reduces an inflected verb and a broken plural to their dictionary forms', async () => {
    expect((await word('وكتبوا الدرس', 'وكتبوا')).lemma).toBe('كَتَب');
    expect((await word('اشتريت الكتب من السوق', 'الكتب')).lemma).toBe('كِتاب');
  });

  it('reads one undiacritized stem differently when its clitics differ', async () => {
    // كتب: "they wrote" (verb) with وَ, "her books" (noun) with فَ and ـها.
    const wrote = await word('وكتبوا الدرس', 'وكتبوا');
    const books = await word('فكتبها كثيرة', 'فكتبها');

    expect([wrote.partOfSpeech, wrote.diacritized]).toEqual(['verb', 'وَكَتَبُوا']);
    expect([books.partOfSpeech, books.lemma]).toEqual(['noun', 'كِتاب']);
  });

  it('analyzes many sentences in a row from one long-lived helper', async () => {
    const sentences = ['سافرت أمس إلى القاهرة', 'أمس كان يوما جميلا', 'طلب العلم فريضة على كل مسلم'];

    const results = await Promise.all(sentences.map((s) => analyzer.analyze(s)));

    expect(results.map((r) => r.length)).toEqual([4, 4, 6]);
    expect(results[2]![1]).toMatchObject({ surface: 'العلم', lemma: 'عِلْم', root: 'ع.ل.م' });
  });

  it('matches its words to speech-to-text words that carry punctuation and numbers', async () => {
    const heard = ['قال', 'المعلم:', '«اقرؤوا', 'الدرس»،', 'صفحة', '١٢.'];
    const tokens = heard.map((surface, i) => ({ surface, startMs: i, endMs: i, gloss: '', lemmaId: null }));

    const analyses = await analyzer.analyze(heard.join(' '));

    expect(alignToTokens(analyses, tokens)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  // MLE disambiguation in camel-tools picks each word's reading out of context
  // (camel_tools/disambig/mle.py), so one bare spelling gets one reading in every sentence.
  // Sentence-context disambiguation is not met yet (#20); these flip to passing when it is.
  it.fails('reads bare كتب as "books" after a verb, not "wrote"', async () => {
    expect((await word('قرأت كتب كثيرة في المكتبة', 'كتب')).partOfSpeech).toBe('noun');
  });

  it.fails('reads العلم as "the flag" when soldiers raise it, not "knowledge"', async () => {
    expect((await word('رفع الجنود العلم فوق المبنى', 'العلم')).lemma).toBe('عَلَم');
  });
});
