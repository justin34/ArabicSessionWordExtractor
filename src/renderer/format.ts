export function formatStart(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** m:ss, or h:mm:ss from one hour. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function sessionDuration(
  s: { startedAt: string; endedAt: string | null },
  now: number,
): string {
  const end = s.endedAt ? new Date(s.endedAt).getTime() : now;
  return formatDuration(end - new Date(s.startedAt).getTime());
}
