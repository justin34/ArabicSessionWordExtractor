/** Turns one provider's timed events into the numbers the spike compares. */
import { summarize, type LatencySummary } from './latency.ts';
import { charErrorRate, wordErrorRate, type ErrorRate } from './score.ts';
import type { SpikeEvent, StreamingStt } from './stream.ts';

export interface TimedEvent extends SpikeEvent {
  /** Wall time the event arrived, in ms since audio time 0 (the clock endMs is on). */
  receivedAtMs: number;
}

export interface RunMetrics {
  provider: string;
  audioMs: number;
  /** Arrival of final text minus the audio time its last word ended: the best-placed word's wait. */
  finalLatency: LatencySummary | null;
  /** Arrival of final text minus the audio time its first word started: the worst-placed word's wait. */
  finalFirstWordLatency: LatencySummary | null;
  /** Arrival of the message that closes an Utterance minus the end of its last word. */
  endpointLatency: LatencySummary | null;
  /** How far interim text trails the audio. */
  interimLag: LatencySummary | null;
  transcript: string;
  wer?: ErrorRate;
  cer?: ErrorRate;
  /** Audio streamed times the provider's list price per hour; not read from a bill. */
  costUsd: number;
}

export function measureRun({
  provider,
  events,
  audioMs,
  reference,
}: {
  provider: Pick<StreamingStt, 'name' | 'finalSeparator' | 'usdPerHour'>;
  events: readonly TimedEvent[];
  audioMs: number;
  reference?: string;
}): RunMetrics {
  const finals = events.filter((e) => e.type === 'final');
  const finalsWithText = finals.filter((e) => e.text.trim() !== '');
  const transcript = finalsWithText
    .map((e) => e.text)
    .join(provider.finalSeparator)
    .replace(/\s+/g, ' ')
    .trim();
  const sinceEnd = (e: TimedEvent) => e.receivedAtMs - e.endMs;
  return {
    provider: provider.name,
    audioMs,
    finalLatency: summarize(finalsWithText.map(sinceEnd)),
    finalFirstWordLatency: summarize(finalsWithText.map((e) => e.receivedAtMs - e.startMs)),
    endpointLatency: summarize(events.filter((e) => e.endpoint).map(sinceEnd)),
    interimLag: summarize(events.filter((e) => e.type === 'interim').map(sinceEnd)),
    transcript,
    ...(reference === undefined
      ? {}
      : { wer: wordErrorRate(reference, transcript), cer: charErrorRate(reference, transcript) }),
    costUsd: (audioMs / 3_600_000) * provider.usdPerHour,
  };
}

/** How far two providers' transcripts agree, as WER of the second against the first. Null unless exactly two runs. */
export function crossProviderAgreement(runs: readonly RunMetrics[]): string | null {
  if (runs.length !== 2) return null;
  const agreement = wordErrorRate(runs[0].transcript, runs[1].transcript);
  return `Cross-provider WER (${runs[0].provider} as reference): ${(agreement.rate * 100).toFixed(1)}%`;
}

const ms = (summary: LatencySummary | null) =>
  summary === null ? 'n/a' : `${Math.round(summary.p50)} / ${Math.round(summary.p95)}`;
const percent = (rate: ErrorRate | undefined) => (rate === undefined ? 'no ref' : `${(rate.rate * 100).toFixed(1)}%`);

export function formatTable(clip: string, runs: readonly RunMetrics[]): string {
  const header =
    '| Clip | Provider | Audio | WER | CER | Final, last word p50 / p95 (ms) | Final, first word p50 / p95 (ms) | ' +
    'Utterance end p50 / p95 (ms) | Interim lag p50 / p95 (ms) | Cost (USD) |';
  const rule = '|---|---|---|---|---|---|---|---|---|---|';
  const rows = runs.map(
    (r) =>
      `| ${clip} | ${r.provider} | ${(r.audioMs / 60_000).toFixed(1)} min | ${percent(r.wer)} | ${percent(r.cer)} | ` +
      `${ms(r.finalLatency)} | ${ms(r.finalFirstWordLatency)} | ${ms(r.endpointLatency)} | ${ms(r.interimLag)} | ` +
      `${r.costUsd.toFixed(4)} |`,
  );
  return [header, rule, ...rows].join('\n');
}
