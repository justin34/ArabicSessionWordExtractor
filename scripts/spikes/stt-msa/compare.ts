/**
 * Prints one side-by-side table from saved runs (results/<label>-<provider>.json), plus
 * how closely the two transcripts agree, for when providers were run one at a time.
 *
 *   node scripts/spikes/stt-msa/compare.ts news class
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crossProviderAgreement, formatTable, type RunMetrics } from './report.ts';

const providers = ['deepgram', 'soniox'];
const labels = process.argv.slice(2);
if (labels.length === 0) {
  console.error('usage: node compare.ts <label> [label...]');
  process.exit(2);
}

for (const label of labels) {
  const runs: RunMetrics[] = providers
    .map((provider) => join(import.meta.dirname, 'results', `${label}-${provider}.json`))
    .filter((path) => existsSync(path))
    .map((path) => (JSON.parse(readFileSync(path, 'utf8')) as { metrics: RunMetrics }).metrics);
  console.log(formatTable(label, runs));
  const agreement = crossProviderAgreement(runs);
  if (agreement) console.log(`\n${agreement}\n`);
}
