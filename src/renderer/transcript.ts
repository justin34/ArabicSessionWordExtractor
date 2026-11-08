import type { LiveUtterance } from './bridge';

/**
 * Insert a new Utterance, or replace the one with the same id (interim becoming final). A new
 * one goes before any that starts later, so the teacher's and the learner's Utterances
 * (two streams, ADR 0004) interleave by start time.
 */
export function applyUpdate(list: LiveUtterance[], update: LiveUtterance): LiveUtterance[] {
  const i = list.findIndex((u) => u.id === update.id);
  if (i === -1) {
    const start = update.startMs;
    const later = start === undefined ? -1 : list.findIndex((u) => u.startMs !== undefined && u.startMs > start);
    if (later === -1) return [...list, update];
    return [...list.slice(0, later), update, ...list.slice(later)];
  }
  const next = [...list];
  next[i] = update;
  return next;
}
