import type { RecordingProbe } from './bridge';

/** How long to wait for a recording's length before importing it without one. */
const PROBE_TIMEOUT_MS = 10_000;

/**
 * Tells a recording's length from its metadata, as Chromium reads it; null when it cannot
 * (a file without a duration, such as MediaRecorder's WebM). The main process then never
 * sends it to Deepgram, which gives up on recordings over 10 minutes.
 */
export const browserRecordingProbe: RecordingProbe = {
  durationMs: (url) =>
    new Promise((resolve) => {
      const audio = new Audio();
      audio.preload = 'metadata';
      const done = (ms: number | null) => {
        clearTimeout(timer);
        audio.onloadedmetadata = null;
        audio.onerror = null;
        audio.removeAttribute('src');
        audio.load();
        resolve(ms);
      };
      const timer = setTimeout(() => done(null), PROBE_TIMEOUT_MS);
      audio.onloadedmetadata = () =>
        done(Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : null);
      audio.onerror = () => done(null);
      audio.src = url;
    }),
};
