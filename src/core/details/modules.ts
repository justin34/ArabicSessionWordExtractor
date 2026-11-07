/**
 * The built-in Detail Modules (ADR 0002). Each one contributes one section of the word
 * panel from its own data source, given a Lemma: the analysis stored in the Vocabulary,
 * the bundled dictionary, or the learner's own Sessions. A module with nothing to show
 * returns null; one that throws is skipped by the panel (see `wordDetails.ts`).
 */
import type { Dictionary } from '../providers';
import type { HeardForm, LemmaRecord, Store } from '../store';
import type { DetailBlock, DetailFact } from '../types';

/** The word a panel is built for. */
export interface WordContext {
  lemma: LemmaRecord;
  /** The surface form that was clicked, when the panel opened from a word. */
  surface?: string;
}

export interface DetailModule {
  /** Stable id, as the configuration lists it. */
  id: string;
  /** The section's heading. */
  title: string;
  /** The section's content for this word, or null (or no blocks) when it has none. */
  build(word: WordContext): Promise<DetailBlock[] | null> | DetailBlock[] | null;
}

/** What the built-in modules read from. */
export interface DetailSources {
  store: Store;
  dictionary: Dictionary;
}

/** Built-in module ids, in the panel's default order. */
export const DEFAULT_DETAIL_MODULES = [
  'form',
  'pronunciation',
  'definitions',
  'examples',
  'own-examples',
  'sessions',
] as const;

const MAX_DEFINITIONS = 8;
const MAX_EXAMPLES = 3;
const MAX_OWN_EXAMPLES = 5;

/** CAMeL parts of speech in plain English; an unknown one is shown as it is. */
const PART_OF_SPEECH: Record<string, string> = {
  noun: 'noun',
  noun_prop: 'proper noun',
  noun_num: 'number',
  noun_quant: 'quantifier',
  adj: 'adjective',
  adj_comp: 'comparative adjective',
  adj_num: 'ordinal number',
  adv: 'adverb',
  adv_interrog: 'interrogative adverb',
  adv_rel: 'relative adverb',
  verb: 'verb',
  verb_pseudo: 'pseudo-verb',
  pron: 'pronoun',
  pron_dem: 'demonstrative pronoun',
  pron_exclam: 'exclamatory pronoun',
  pron_interrog: 'interrogative pronoun',
  pron_rel: 'relative pronoun',
  prep: 'preposition',
  conj: 'conjunction',
  conj_sub: 'subordinating conjunction',
  part: 'particle',
  part_neg: 'negative particle',
  part_interrog: 'interrogative particle',
  part_verb: 'verbal particle',
  interj: 'interjection',
  abbrev: 'abbreviation',
  digit: 'digit',
};

export function readablePartOfSpeech(pos: string): string {
  return PART_OF_SPEECH[pos] ?? pos.replace(/_/g, ' ');
}

/** CAMeL marks words without a true root (particles, loanwords) with # radicals. */
function learnableRoot(root: string | null): string | null {
  return root && !root.includes('#') ? root : null;
}

/** The form that was clicked, else the first form heard. */
function heardForm(word: WordContext, wanted: (f: HeardForm) => boolean = () => true): HeardForm | undefined {
  const forms = word.lemma.forms.filter(wanted);
  return forms.find((f) => f.surface === word.surface) ?? forms[0];
}

function sessionLabel(startedAt: string): string {
  return new Date(startedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const times = (n: number) => (n === 1 ? 'once' : `${n} times`);

/** Dictionary form, the form heard, part of speech, root and pattern, from the analyzer. */
function formModule(): DetailModule {
  return {
    id: 'form',
    title: 'Form',
    build({ lemma, surface }) {
      const facts: DetailFact[] = [{ label: 'Dictionary form', value: lemma.lemma, arabic: true }];
      const form = surface ? lemma.forms.find((f) => f.surface === surface) : undefined;
      const heard = form?.diacritized ?? form?.surface;
      if (heard && heard !== lemma.lemma) facts.push({ label: 'Heard as', value: heard, arabic: true });
      if (lemma.partOfSpeech) facts.push({ label: 'Part of speech', value: readablePartOfSpeech(lemma.partOfSpeech) });
      const root = learnableRoot(lemma.root);
      if (root) facts.push({ label: 'Root', value: root, arabic: true });
      if (lemma.pattern) facts.push({ label: 'Pattern', value: lemma.pattern, arabic: true });
      return [{ kind: 'facts', facts }];
    },
  };
}

/** The phonetic transcription (CAMeL's CAPHI) of the form heard. */
function pronunciationModule(): DetailModule {
  return {
    id: 'pronunciation',
    title: 'Pronunciation',
    build(word) {
      const form = heardForm(word, (f) => !!f.pronunciation);
      if (!form?.pronunciation) return null;
      return [
        {
          kind: 'facts',
          facts: [
            { label: 'Form', value: form.diacritized ?? form.surface, arabic: true },
            { label: 'Sounds', value: form.pronunciation },
          ],
        },
      ];
    },
  };
}

/** Full definitions and etymology from the bundled dictionary. */
function definitionsModule({ dictionary }: DetailSources): DetailModule {
  return {
    id: 'definitions',
    title: 'Definitions',
    async build({ lemma }) {
      const entry = await dictionary.lookup(lemma.lemma, lemma.partOfSpeech ?? undefined);
      if (!entry) return null;
      const blocks: DetailBlock[] = [];
      if (entry.definitions.length > 0) {
        blocks.push({
          kind: 'list',
          ordered: true,
          items: entry.definitions.slice(0, MAX_DEFINITIONS).map((text) => ({ text })),
        });
      }
      if (entry.etymology) blocks.push({ kind: 'text', heading: 'Etymology', text: entry.etymology });
      return blocks;
    },
  };
}

/** General example sentences (Tatoeba) using the word as heard or in its dictionary form. */
function examplesModule({ dictionary }: DetailSources): DetailModule {
  return {
    id: 'examples',
    title: 'Examples',
    async build({ lemma }) {
      const spellings = [lemma.lemma, ...lemma.forms.map((f) => f.surface)];
      const found = await dictionary.examples(spellings, MAX_EXAMPLES);
      if (found.length === 0) return null;
      return [{ kind: 'examples', examples: found.map(({ arabic, english }) => ({ arabic, english })) }];
    },
  };
}

/** The learner's own Utterances the word was heard in, most recent first. */
function ownExamplesModule({ store }: DetailSources): DetailModule {
  return {
    id: 'own-examples',
    title: 'Your examples',
    build({ lemma }) {
      const heard = store.lemmaUtterances(lemma.id, MAX_OWN_EXAMPLES);
      if (heard.length === 0) return null;
      return [
        {
          kind: 'examples',
          examples: heard.map((u) => ({
            arabic: u.text,
            english: u.translation,
            note: sessionLabel(u.sessionStartedAt),
          })),
        },
      ];
    },
  };
}

/** Every Session the word was heard in, with how often. */
function sessionsModule({ store }: DetailSources): DetailModule {
  return {
    id: 'sessions',
    title: 'Heard in',
    build({ lemma }) {
      const sessions = store.lemmaSessions(lemma.id);
      if (sessions.length === 0) return null;
      return [
        {
          kind: 'list',
          items: sessions.map((s) => ({ text: sessionLabel(s.startedAt), note: `heard ${times(s.count)}` })),
        },
      ];
    },
  };
}

/** The built-in Detail Modules, by id. */
export function builtInDetailModules(sources: DetailSources): Map<string, DetailModule> {
  const modules = [
    formModule(),
    pronunciationModule(),
    definitionsModule(sources),
    examplesModule(sources),
    ownExamplesModule(sources),
    sessionsModule(sources),
  ];
  return new Map(modules.map((m) => [m.id, m]));
}
