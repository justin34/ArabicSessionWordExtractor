import type { DemoFeed, LiveUtterance } from './bridge';

type Sentence = { words: Array<[string, string]>; translation: string };

// Hardcoded MSA with tashkeel. Enough Utterances to make Live View scroll.
const SCRIPT: Sentence[] = [
  { words: [['مَرْحَباً', 'hello'], ['بِكُمْ', 'to you all'], ['فِي', 'in'], ['الدَّرْسِ', 'the lesson']], translation: 'Welcome to the lesson, everyone.' },
  { words: [['اليَوْمَ', 'today'], ['سَنَتَعَلَّمُ', 'we will learn'], ['كَلِمَاتٍ', 'words'], ['جَدِيدَةً', 'new']], translation: 'Today we will learn some new words.' },
  { words: [['ذَهَبَ', 'went'], ['الطَّالِبُ', 'the student'], ['إِلَى', 'to'], ['المَدْرَسَةِ', 'the school']], translation: 'The student went to the school.' },
  { words: [['كَتَبَ', 'wrote'], ['المُعَلِّمُ', 'the teacher'], ['الدَّرْسَ', 'the lesson'], ['عَلَى', 'on'], ['السَّبُّورَةِ', 'the board']], translation: 'The teacher wrote the lesson on the board.' },
  { words: [['هَلْ', 'whether'], ['فَهِمْتُمْ', 'you understood'], ['القَاعِدَةَ', 'the rule']], translation: 'Did you understand the rule?' },
  { words: [['نَعَمْ', 'yes'], ['وَلَكِنْ', 'but'], ['أُرِيدُ', 'I want'], ['مِثَالاً', 'an example']], translation: 'Yes, but I would like an example.' },
  { words: [['قَرَأَ', 'read'], ['الوَلَدُ', 'the boy'], ['الكِتَابَ', 'the book'], ['الجَدِيدَ', 'the new']], translation: 'The boy read the new book.' },
  { words: [['شُكْراً', 'thanks'], ['جَزِيلاً', 'abundant'], ['وَإِلَى', 'and until'], ['اللِّقَاءِ', 'the meeting']], translation: 'Thank you very much, and until next time.' },
];

const INTERIM_STEP_MS = 700;
const FINAL_DELAY_MS = 900;

/** Drip-feeds interim then finalized Utterances on a timer, like the real pipeline will. */
export const scriptedDemoFeed: DemoFeed = (onUpdate) => {
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const at = (ms: number, fn: () => void) => void timers.push(setTimeout(fn, ms));

  let t = 800;
  SCRIPT.forEach((sentence, n) => {
    const id = `demo-${n}`;
    const text = sentence.words.map(([w]) => w).join(' ');
    // Interim text grows word by word.
    for (let i = 1; i <= sentence.words.length; i++) {
      const partial = sentence.words.slice(0, i).map(([w]) => w).join(' ');
      const interim: LiveUtterance = { id, isFinal: false, text: partial, translation: '', tokens: [] };
      at(t, () => onUpdate(interim));
      t += INTERIM_STEP_MS;
    }
    t += FINAL_DELAY_MS;
    const final: LiveUtterance = {
      id,
      isFinal: true,
      text,
      translation: sentence.translation,
      tokens: sentence.words.map(([surface, gloss], i) => ({
        surface,
        gloss,
        startMs: n * 5000 + i * 450,
        endMs: n * 5000 + i * 450 + 400,
        lemmaId: null,
      })),
    };
    at(t, () => onUpdate(final));
    t += 600;
  });

  return () => timers.forEach(clearTimeout);
};

/** Demo Sessions are developer tooling: offered by the dev server, never by a built app. */
export const demoFeedForBuild = (isDev: boolean): DemoFeed | undefined =>
  isDev ? scriptedDemoFeed : undefined;
