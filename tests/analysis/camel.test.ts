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

async function word(sentence: string, surface: string, translation?: string): Promise<TokenAnalysis> {
  const token = (await analyzer.analyze(sentence, translation)).find((t) => t.surface === surface);
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

  it('reads bare كتب as "books" after a verb, and as "wrote" at the start of a sentence', async () => {
    expect((await word('قرأت كتب كثيرة في المكتبة', 'كتب')).partOfSpeech).toBe('noun');
    expect((await word('كتب الطالب الدرس', 'كتب')).partOfSpeech).toBe('verb');
    // كان and its sisters take a verb straight after them.
    expect((await word('كان كتب الرسالة', 'كتب')).partOfSpeech).toBe('verb');
  });

  it('reads العلم as "the flag" when its translation says so, and "knowledge" otherwise', async () => {
    const flag = await word('رفع الجنود العلم فوق المبنى', 'العلم', 'The soldiers raised the flag above the building');
    const knowledge = await word('طلب العلم فريضة على كل مسلم', 'العلم', 'Seeking knowledge is a duty of every Muslim');

    expect([flag.lemma, flag.stemGloss]).toEqual(['عَلَم', 'flag;banner;badge']);
    expect(knowledge.lemma).toBe('عِلْم');
  });

  // Each spelling, read two ways in two real MSA sentences by their translations.
  it.each([
    ['العالم', 'سافر حول العالم', 'He traveled around the world', 'عالَم', 'noun'],
    ['العالم', 'اكتشف العالم دواء جديدا', 'The scientist discovered a new medicine', 'عالِم', 'noun'],
    ['ذهب', 'ذهب الولد إلى المدرسة', 'The boy went to school', 'ذَهَب', 'verb'],
    ['ذهب', 'اشترت خاتما من ذهب', 'She bought a ring of gold', 'ذَهَب', 'noun'],
    ['عمر', 'قال عمر إنه سيأتي', 'Omar said he would come', 'عُمَر', 'noun_prop'],
    ['عمر', 'عمر الإنسان قصير', 'Human life is short', 'عُمْر', 'noun'],
    ['قدم', 'قدم الطالب بحثه', 'The student presented his research', 'قَدَّم', 'verb'],
    ['قدم', 'كسرت قدم اللاعب', "The player's foot was broken", 'قَدَم', 'noun'],
    ['حب', 'حب الوطن واجب', 'Love of the homeland is a duty', 'حُبّ', 'noun'],
    ['حب', 'يأكل الطائر حب القمح', 'The bird eats wheat grains', 'حَبّ', 'noun'],
  ])('reads %s in "%s" (%s) as %s', async (surface, sentence, translation, lemma, partOfSpeech) => {
    expect(await word(sentence, surface, translation)).toMatchObject({ lemma, partOfSpeech });
  });

  it("takes the MLE model's reading of a word it knows, not a look-alike", async () => {
    // camel-tools' own matching gave ليس "be valiant", لست "taste" and أيضا "metabolism".
    expect((await word('ليس الطالب في البيت', 'ليس')).diacritized).toBe('لَيْسَ');
    expect((await word('لست طالبا', 'لست')).diacritized).toBe('لَسْتُ');
    expect(await word('أنا أيضا طالب', 'أيضا')).toMatchObject({ lemma: 'أَيْضاً', partOfSpeech: 'adv' });
  });

  it('keeps function words as they are, whatever the translation', async () => {
    // "took" would otherwise match آلَى "take an oath" for إلى.
    const to = await word('أخذ سامي ليلى إلى المركز الصحي', 'إلى', 'Sami took Layla to the health center');

    expect([to.lemma, to.partOfSpeech]).toEqual(['إِلَى', 'prep']);
  });

  it('analyzes a sentence with its translation in milliseconds', async () => {
    const started = performance.now();
    for (let i = 0; i < 20; i++) {
      await analyzer.analyze(`قرأت كتب كثيرة في المكتبة رقم ${i}`, 'I read many books in the library');
    }
    expect((performance.now() - started) / 20).toBeLessThan(50);
  });
});
