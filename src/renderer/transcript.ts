import type { LiveUtterance } from './bridge';

/** Insert a new Utterance, or replace the one with the same id (interim becoming final). */
export function applyUpdate(list: LiveUtterance[], update: LiveUtterance): LiveUtterance[] {
  const i = list.findIndex((u) => u.id === update.id);
  if (i === -1) return [...list, update];
  const next = [...list];
  next[i] = update;
  return next;
}
