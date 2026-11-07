/**
 * Streams one WAV clip to each provider at real-time speed, in parallel, and prints a
 * side-by-side Markdown table. Keys come from the environment or a git-ignored `.env`
 * next to this file. Transcripts and raw events go to `results/` (also git-ignored).
 *
 *   node scripts/spikes/stt-msa/run.ts --clip clips/news.wav --ref clips/news.txt --label news
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DeepgramStt } from './deepgram.ts';
import { paceFrames } from './pacer.ts';
import { crossProviderAgreement, formatTable, measureRun, type RunMetrics, type TimedEvent } from './report.ts';
import { arabicLines } from './score.ts';
import { SonioxStt } from './soniox.ts';
import type { StreamingStt } from './stream.ts';
import { parseWav } from './wav.ts';

const here = import.meta.dirname;

const { values } = parseArgs({
  options: {
    clip: { type: 'string' },
    ref: { type: 'string' },
    label: { type: 'string' },
    providers: { type: 'string', default: 'deepgram,soniox' },
    language: { type: 'string', default: 'ar' },
    'frame-ms': { type: 'string', default: '50' },
    'max-seconds': { type: 'string' },
    /** JSON merged into the Soniox start request, for endpoint tuning. */
    'soniox-config': { type: 'string', default: '{}' },
  },
});

if (!values.clip) {
  console.error('usage: node run.ts --clip <16-bit PCM wav> [--ref <reference.txt>] [--label name] [--providers deepgram,soniox] [--max-seconds N]');
  process.exit(2);
}
if (existsSync(join(here, '.env'))) process.loadEnvFile(join(here, '.env'));

function requireKey(name: string): string {
  const key = process.env[name];
  if (!key) {
    console.error(`${name} is not set (put it in ${join(here, '.env')}, see .env.example)`);
    process.exit(2);
  }
  return key;
}

const factories: Record<string, () => StreamingStt> = {
  deepgram: () => new DeepgramStt(requireKey('DEEPGRAM_API_KEY')),
  soniox: () => new SonioxStt(requireKey('SONIOX_API_KEY'), { overrides: JSON.parse(values['soniox-config']) }),
};

const clipPath = resolve(values.clip);
const label = values.label ?? clipPath.replace(/^.*[\\/]/, '').replace(/\.wav$/i, '');
const wav = parseWav(readFileSync(clipPath));
const sampleBytes = wav.channels * 2;
const maxBytes = values['max-seconds']
  ? Math.floor((Number(values['max-seconds']) * 1000 * wav.bytesPerMs) / sampleBytes) * sampleBytes
  : wav.pcm.length;
const pcm = wav.pcm.subarray(0, Math.min(wav.pcm.length, maxBytes));
const audioMs = pcm.length / wav.bytesPerMs;
if (pcm.length === 0) throw new Error('no audio to stream');
const reference = values.ref ? arabicLines(readFileSync(resolve(values.ref), 'utf8')) : undefined;
if (reference === '') throw new Error(`${values.ref} has no Arabic lines to score against`);
const format = { sampleRate: wav.sampleRate, channels: wav.channels, language: values.language };
const frameMs = Number(values['frame-ms']);

async function runOne(stt: StreamingStt): Promise<{ metrics: RunMetrics; events: TimedEvent[] }> {
  /** Audio time 0: when pacing starts, once the socket is open. */
  let origin: number | undefined;
  async function* frames() {
    origin = performance.now();
    yield* paceFrames(pcm, { bytesPerMs: wav.bytesPerMs, frameMs, sampleBytes });
  }
  const events: TimedEvent[] = [];
  for await (const event of stt.transcribe(frames(), format)) {
    events.push({ ...event, receivedAtMs: performance.now() - (origin ?? performance.now()) });
  }
  const metrics = measureRun({ provider: stt, events, audioMs, reference });
  return { metrics, events };
}

const names = values.providers.split(',').map((name) => name.trim());
const providers = names.map((name) => {
  const factory = factories[name];
  if (!factory) throw new Error(`unknown provider ${name}; known: ${Object.keys(factories).join(', ')}`);
  return factory();
});

console.error(`${label}: streaming ${(audioMs / 60_000).toFixed(1)} min at ${wav.sampleRate} Hz to ${names.join(', ')} in real time...`);
const settled = await Promise.allSettled(providers.map(runOne));

const resultsDir = join(here, 'results');
mkdirSync(resultsDir, { recursive: true });
const runs: RunMetrics[] = [];
settled.forEach((outcome, i) => {
  if (outcome.status === 'rejected') {
    console.error(`${names[i]} failed: ${(outcome.reason as Error).message}`);
    return;
  }
  runs.push(outcome.value.metrics);
  const base = join(resultsDir, `${label}-${names[i]}`);
  writeFileSync(`${base}.txt`, outcome.value.metrics.transcript + '\n');
  writeFileSync(`${base}.json`, JSON.stringify({ ...outcome.value, clip: clipPath, frameMs }, null, 2));
});

console.log(formatTable(label, runs));
const agreement = crossProviderAgreement(runs);
if (agreement) console.log(`\n${agreement}`);
console.error(`transcripts and events written to ${resultsDir}`);
if (runs.length < providers.length) process.exitCode = 1;
