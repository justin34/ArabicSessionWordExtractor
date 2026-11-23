/**
 * Naming and removing completed Sessions (GLOSSARY: Session name, Remove a Session; ADR
 * 0005). Removing deletes the rows in one transaction, then the audio files; a file that
 * cannot be deleted (Windows keeps a file being played locked) is swept on the next launch.
 */
import { readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readableStemGloss } from './dictionary/gloss';
import type { StudyGuides } from './guides/studyGuides';
import type { MicTranscriptions } from './micTranscription';
import type { SessionAudio, Store } from './store';
import { MAX_SESSION_NAME, type RemovalPreview, type Session } from './types';

/** A Session name as stored: trimmed, null when empty. Throws for one over the length limit. */
export function normalizeSessionName(name: string | null): string | null {
  const trimmed = name?.trim() ?? '';
  if (trimmed === '') return null;
  if ([...trimmed].length > MAX_SESSION_NAME) {
    throw new Error(`A Session name can be at most ${MAX_SESSION_NAME} characters.`);
  }
  return trimmed;
}

/** Deletes a Session's audio files; one that cannot be deleted now is left for the next launch's sweep. */
export function deleteAudioFiles(audio: SessionAudio): void {
  for (const path of [audio.desktopTrackPath, audio.micTrackPath]) {
    if (!path) continue;
    try {
      rmSync(path, { force: true });
    } catch (err) {
      console.warn(`Could not delete ${path} now; it is deleted on the next launch:`, err);
    }
  }
}

/** A Session's audio file, by the name the app gives it. */
const SESSION_AUDIO = /^session-\d+-/;

/** Deletes every Session audio file in `dir` that no stored Session points to. */
export function sweepAudioFiles(dir: string, keep: string[]): void {
  const kept = new Set(keep.map((p) => resolve(p).toLowerCase()));
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(dir, name);
    if (!SESSION_AUDIO.test(name) || kept.has(resolve(path).toLowerCase())) continue;
    try {
      rmSync(path, { force: true });
    } catch (err) {
      console.warn(`Could not delete the unused audio file ${path}:`, err);
    }
  }
}

export class SessionLibrary {
  constructor(
    private readonly store: Store,
    private readonly micTranscriptions: MicTranscriptions,
    private readonly guides: StudyGuides,
  ) {}

  /** Names a completed Session, or with an empty name or null, unnames it. */
  rename(sessionId: number, name: string | null): Session {
    const session = this.completed(sessionId);
    if (typeof session === 'string') throw new Error(session);
    return this.store.renameSession(sessionId, normalizeSessionName(name), new Date().toISOString());
  }

  /** Why a Session cannot be removed now; undefined when it can. */
  removalRefusal(sessionId: number): string | undefined {
    const session = this.completed(sessionId);
    if (typeof session === 'string') return session;
    if (this.micTranscriptions.status(sessionId)?.state === 'running') {
      return 'Wait for your speech to be transcribed first.';
    }
    return undefined;
  }

  /** The words that would leave the Vocabulary: those heard in this Session only. */
  removalPreview(sessionId: number): RemovalPreview {
    const refused = this.removalRefusal(sessionId);
    if (refused) throw new Error(refused);
    return {
      words: this.store.lemmasOnlyIn(sessionId).map((l) => ({
        lemmaId: l.lemmaId,
        lemma: l.lemma,
        gloss: l.gloss || (l.stemGloss ? readableStemGloss(l.stemGloss) : ''),
        ignored: l.ignored,
      })),
    };
  }

  /**
   * Removes a completed Session (ADR 0005): purged, or with `keepWords` left as a Removed
   * Session. The Word Cards of the Lemmas it fed are rebuilt in the background.
   */
  remove(sessionId: number, { keepWords }: { keepWords: boolean }): void {
    const refused = this.removalRefusal(sessionId);
    if (refused) throw new Error(refused);
    const removed = keepWords ? this.store.tombstoneSession(sessionId) : this.store.purgeSession(sessionId);
    deleteAudioFiles(removed.audio);
    this.guides.rebuildWordCards(removed.lemmaIds);
  }

  /** The Session when it is completed; else why it is not, as a message. */
  private completed(sessionId: number): Session | string {
    let session: Session;
    try {
      session = this.store.getSession(sessionId);
    } catch {
      return 'There is no such Session.';
    }
    if (session.status === 'recording') return 'Stop the Session first.';
    if (session.status === 'importing') return 'The Session is still being imported.';
    if (session.status === 'removed') return 'There is no such Session.';
    return session;
  }
}
