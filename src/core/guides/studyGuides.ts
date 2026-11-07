/**
 * Study guides (GLOSSARY): a read-only Word Card per Lemma and a Session Guide per
 * Session, both stored as generated. A Word Card is built from the enabled Detail Modules
 * (ADR 0002) when its Lemma first enters the Vocabulary, and rebuilt when a Session the
 * Lemma was heard in ends, so the modules drawn from the learner's own Sessions stay
 * current. A Session Guide lists the Lemmas first heard in its Session, grouped by part
 * of speech, each linking to its Word Card by Lemma id.
 */
import { readableStemGloss } from '../dictionary/gloss';
import type { WordDetailsBuilder } from '../details/wordDetails';
import type { NewLemma, Store } from '../store';
import type { SessionGuide, SessionGuideGroup, WordCard } from '../types';

/** Session Guide groups, in the order shown; a Lemma goes in the first that takes its part of speech. */
const GROUPS: Array<{ title: string; takes: (pos: string) => boolean }> = [
  { title: 'Nouns', takes: (pos) => pos === 'noun' || pos === 'noun_num' || pos === 'noun_quant' },
  { title: 'Verbs', takes: (pos) => pos.startsWith('verb') },
  { title: 'Adjectives', takes: (pos) => pos.startsWith('adj') },
  { title: 'Adverbs', takes: (pos) => pos.startsWith('adv') },
  { title: 'Names', takes: (pos) => pos === 'noun_prop' },
  { title: 'Other words', takes: () => true },
];

export function groupNewLemmas(lemmas: NewLemma[]): SessionGuideGroup[] {
  const groups = GROUPS.map(({ title }) => ({ title, words: [] as SessionGuideGroup['words'] }));
  for (const l of lemmas) {
    const i = GROUPS.findIndex((g) => g.takes(l.partOfSpeech ?? ''));
    groups[i].words.push({
      lemmaId: l.lemmaId,
      lemma: l.lemma,
      gloss: l.gloss || (l.stemGloss ? readableStemGloss(l.stemGloss) : ''),
      partOfSpeech: l.partOfSpeech,
      count: l.count,
    });
  }
  return groups.filter((g) => g.words.length > 0);
}

/** What the Session pipeline tells the study guides. Both settle, never reject. */
export interface StudyGuideHooks {
  /** Lemmas were just heard; any new to the Vocabulary get their Word Card. */
  lemmasHeard(lemmaIds: number[]): Promise<void>;
  /** A Session just ended: its Session Guide is generated. */
  sessionEnded(sessionId: number): Promise<void>;
}

export class StudyGuides implements StudyGuideHooks {
  /** Background work (rebuilding Word Cards, catching up on old data). Each settles, never rejects. */
  private readonly pending = new Set<Promise<void>>();
  private stopped = false;

  constructor(
    private readonly store: Store,
    private readonly builder: WordDetailsBuilder,
  ) {}

  wordCard(lemmaId: number): WordCard | undefined {
    return this.store.getWordCard(lemmaId);
  }

  sessionGuide(sessionId: number): SessionGuide | undefined {
    return this.store.getSessionGuide(sessionId);
  }

  async lemmasHeard(lemmaIds: number[]): Promise<void> {
    try {
      const missing = [...new Set(lemmaIds)].filter((id) => !this.store.getWordCard(id));
      await this.buildWordCards(missing, false);
    } catch (err) {
      console.error('Word Cards could not be generated:', err);
    }
  }

  /**
   * Generates the Session Guide at once. The Word Cards of the Lemmas heard in the Session
   * are then rebuilt in the background (see `idle`).
   */
  async sessionEnded(sessionId: number): Promise<void> {
    try {
      this.generateSessionGuide(sessionId);
    } catch (err) {
      console.error(`Session Guide could not be generated for Session ${sessionId}:`, err);
    }
    this.inBackground(() => this.buildWordCards(this.store.sessionLemmaIds(sessionId), true));
  }
  /**
   * Gives every Lemma without a Word Card and every completed Session without a Session
   * Guide theirs, e.g. for data from before study guides existed or a Session a crash ended.
   */
  catchUp(): void {
    this.inBackground(async () => {
      for (const id of this.store.completedSessionsWithoutGuide()) this.generateSessionGuide(id);
      await this.buildWordCards(this.store.lemmasWithoutWordCard(), false);
    });
  }

  /** Settles once no background work is left. */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all(this.pending);
  }

  private generateSessionGuide(sessionId: number): void {
    this.store.putSessionGuide({
      sessionId,
      generatedAt: new Date().toISOString(),
      lemmasHeard: this.store.sessionLemmaIds(sessionId).length,
      groups: groupNewLemmas(this.store.newLemmasInSession(sessionId)),
    });
  }

  /** Stops building Word Cards, before storage closes. */
  stop(): void {
    this.stopped = true;
  }

  /** Builds (or, with `replace`, rebuilds) each Lemma's Word Card. A failure skips that card. */
  private async buildWordCards(lemmaIds: number[], replace: boolean): Promise<void> {
    for (const lemmaId of lemmaIds) {
      if (this.stopped) return;
      try {
        const details = await this.builder.details(lemmaId);
        if (this.stopped) return;
        if (details) this.store.putWordCard(lemmaId, details.sections, new Date().toISOString(), replace);
      } catch (err) {
        console.error(`Word Card could not be generated for Lemma ${lemmaId}:`, err);
      }
    }
  }

  private inBackground(work: () => Promise<void>): void {
    const task: Promise<void> = Promise.resolve()
      .then(work)
      .catch((err) => console.error('Study guide work failed:', err))
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
  }
}
