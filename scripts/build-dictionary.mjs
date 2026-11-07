// Builds the bundled dictionary (GLOSSARY, Dictionary plan) from the raw sources:
//
//   - English Wiktionary, Arabic entries only, from kaikki.org's raw wiktextract dump
//     (raw-wiktextract-data.jsonl.gz, about 2.9 GB). kaikki's Arabic-only file is
//     deprecated, so the whole dump is streamed once and everything else dropped.
//   - Tatoeba Arabic-English sentence pairs, from the per-language exports.
//
//   vendor/dictionary-sources/   the downloads, kept so a rebuild need not fetch them again
//   vendor/dictionary/
//     dictionary.db              what the app reads (src/core/dictionary/sqlite.ts)
//     NOTICE.txt                 attribution and licences, shipped beside it
//
// Packaged builds are to ship vendor/dictionary as resources/dictionary.
// Tatoeba ships bzip2, which Node cannot read: it is decompressed by the CAMeL helper's
// Python (npm run build:helper), else `py -3`, else `python`.
// Re-running is safe: downloads are skipped when present. Pass --refresh to fetch again.
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { DictionaryWriter, tatoebaPairs, tatoebaSentence, wiktionaryRow } from '../src/core/dictionary/data.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcesDir = join(root, 'vendor', 'dictionary-sources');
const outDir = join(root, 'vendor', 'dictionary');
const refresh = process.argv.includes('--refresh');

const TATOEBA = 'https://downloads.tatoeba.org/exports/per_language';
const SOURCES = {
  wiktionary: 'https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz',
  arabic: `${TATOEBA}/ara/ara_sentences.tsv.bz2`,
  english: `${TATOEBA}/eng/eng_sentences.tsv.bz2`,
  links: `${TATOEBA}/ara/ara-eng_links.tsv.bz2`,
};

/** Downloads `url` into the sources folder unless it is there; returns its path and Last-Modified. */
async function download(url) {
  const path = join(sourcesDir, url.split('/').at(-1));
  const infoPath = `${path}.json`;
  if (!refresh && existsSync(path) && existsSync(infoPath)) return { path, ...JSON.parse(readFileSync(infoPath, 'utf8')) };
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status} ${url}`);
  const total = Number(response.headers.get('content-length')) || 0;
  let received = 0;
  let lastReport = 0;
  const body = Readable.fromWeb(response.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    if (total && received - lastReport > 200 * 1024 * 1024) {
      lastReport = received;
      console.log(`  ${((100 * received) / total).toFixed(0)}% of ${(total / 1e9).toFixed(2)} GB`);
    }
  });
  await pipeline(body, createWriteStream(`${path}.part`));
  renameSync(`${path}.part`, path);
  const info = { url, lastModified: response.headers.get('last-modified') ?? 'unknown', bytes: received };
  writeFileSync(infoPath, JSON.stringify(info, null, 2));
  return { path, ...info };
}

function pythonCommand() {
  const bundled = join(root, 'vendor', 'camel-helper', 'python', 'python.exe');
  if (existsSync(bundled)) return [bundled, []];
  return process.platform === 'win32' ? ['py', ['-3']] : ['python3', []];
}

/** The lines of a bzip2 file, decompressed by Python. */
async function* bz2Lines(path) {
  const [cmd, args] = pythonCommand();
  const script = 'import bz2,shutil,sys; shutil.copyfileobj(bz2.open(sys.argv[1]), sys.stdout.buffer)';
  const child = spawn(cmd, [...args, '-c', script, path], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`bz2 decompression of ${path} exited ${code}`))));
  });
  yield* createInterface({ input: child.stdout, crlfDelay: Infinity });
  await exited;
}

async function readSentences(path, wanted) {
  const sentences = new Map();
  for await (const line of bz2Lines(path)) {
    const parsed = tatoebaSentence(line);
    if (parsed && (!wanted || wanted.has(parsed[0]))) sentences.set(parsed[0], parsed[1]);
  }
  return sentences;
}

mkdirSync(sourcesDir, { recursive: true });
mkdirSync(outDir, { recursive: true });
const downloads = {};
for (const [name, url] of Object.entries(SOURCES)) downloads[name] = await download(url);

const tmp = join(outDir, 'dictionary.db.tmp');
rmSync(tmp, { force: true });
const writer = new DictionaryWriter(tmp);

// 1. Wiktionary. Arabic entries are a sliver of the dump; parse only lines that could be one.
console.log('Extracting Arabic entries from the Wiktionary dump (this takes a while)');
const started = Date.now();
let lines = 0;
let kept = 0;
const dump = createReadStream(downloads.wiktionary.path).pipe(createGunzip());
for await (const line of createInterface({ input: dump, crlfDelay: Infinity })) {
  if (++lines % 1_000_000 === 0) console.log(`  ${lines / 1_000_000}M lines, ${kept} entries kept`);
  if (!line.includes('"ar"')) continue;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }
  const row = wiktionaryRow(entry);
  if (!row) continue;
  writer.addEntry(row);
  kept++;
}
console.log(`  ${kept} Arabic entries from ${lines} lines in ${((Date.now() - started) / 60000).toFixed(1)} min`);

// 2. Tatoeba.
console.log('Pairing Tatoeba sentences');
const links = [];
for await (const line of bz2Lines(downloads.links.path)) {
  const [ar, en] = line.split('\t').map(Number);
  if (Number.isInteger(ar) && Number.isInteger(en)) links.push([ar, en]);
}
const arabic = await readSentences(downloads.arabic.path);
const english = await readSentences(downloads.english.path, new Set(links.map(([, en]) => en)));
for (const pair of tatoebaPairs(arabic, english, links)) writer.addExample(pair);

const builtAt = new Date().toISOString();
const counts = writer.finish({
  built_at: builtAt,
  wiktionary_source: `${SOURCES.wiktionary} (Last-Modified ${downloads.wiktionary.lastModified})`,
  wiktionary_licence: 'CC BY-SA 4.0 (Wiktionary text, also GFDL); extracted by wiktextract, kaikki.org',
  tatoeba_source: `${TATOEBA}/ara (Last-Modified ${downloads.arabic.lastModified})`,
  tatoeba_licence: 'CC BY 2.0 FR',
});
const out = join(outDir, 'dictionary.db');
rmSync(out, { force: true });
renameSync(tmp, out);

writeFileSync(
  join(outDir, 'NOTICE.txt'),
  `dictionary.db, built ${builtAt}

Definitions: English Wiktionary (https://en.wiktionary.org), Arabic entries, by
Wiktionary contributors. Licensed CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).
Extracted with wiktextract (Tatu Ylonen, LREC 2022) from kaikki.org's raw dump:
${SOURCES.wiktionary} (Last-Modified ${downloads.wiktionary.lastModified}).
Changes: only Arabic entries, only their headword, part of speech and sense glosses.

Example sentences: Tatoeba (https://tatoeba.org), Arabic-English pairs, by Tatoeba
contributors. Licensed CC BY 2.0 FR (https://creativecommons.org/licenses/by/2.0/fr/).
Source: ${TATOEBA}/ara and ${TATOEBA}/eng (Last-Modified ${downloads.arabic.lastModified}).
`,
);

const mb = (statSync(out).size / 1e6).toFixed(1);
console.log(`Wrote ${out}: ${counts.entries} entries, ${counts.examples} example pairs, ${mb} MB`);
