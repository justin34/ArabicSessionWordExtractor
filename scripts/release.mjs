// `npm run release`: builds the Installer and uploads it as a draft GitHub Release
// v<version> (GLOSSARY: Installer). Publishing the draft is done by hand on GitHub.
//
// Before anything is uploaded, the packaged build (release/win-unpacked) is launched with
// --self-check: its CAMeL helper must analyze a sentence and its dictionary must open. If
// either fails there is no release.
//
// Needs: a clean working tree whose HEAD is pushed (the release is tagged there), a version
// in package.json no release has used yet, and `gh` signed in to the repo.
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const { version, productName } = pkg;
const { owner, repo } = pkg.build.publish[0];
const tag = `v${version}`;
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

function fail(message) {
  console.error(`\nNo release: ${message}`);
  process.exit(1);
}

// 1. Where and what the release will be.
if (git('status', '--porcelain')) fail('the working tree has uncommitted changes.');
const commit = git('rev-parse', 'HEAD');
git('fetch', 'origin');
if (!git('branch', '-r', '--contains', commit)) fail(`commit ${commit.slice(0, 7)} is not pushed.`);
const existing = spawnSync('gh', ['release', 'view', tag, '--repo', `${owner}/${repo}`], { cwd: root, stdio: 'ignore' });
if (existing.status === 0) fail(`${tag} already exists: raise the version in package.json.`);

// 2. The Installer.
execSync('npm run dist', { cwd: root, stdio: 'inherit' });

// 3. The packaged build's own check of its helper and dictionary.
const exe = join(root, 'release', 'win-unpacked', `${productName}.exe`);
if (!existsSync(exe)) fail(`there is no packaged build at ${exe}.`);
const work = mkdtempSync(join(tmpdir(), 'release-check-'));
try {
  const resultFile = join(work, 'self-check.json');
  console.log(`\nChecking the packaged build: ${exe} --self-check`);
  spawnSync(exe, [`--self-check=${resultFile}`], { stdio: 'inherit', timeout: 180_000 });
  if (!existsSync(resultFile)) fail('the packaged build did not finish its check.');
  const result = JSON.parse(readFileSync(resultFile, 'utf8'));
  if (!result.ok) {
    const reasons = [result.error, result.analysis, result.dictionary, ...(result.problems ?? [])].filter(Boolean);
    fail(`the packaged build failed its check:\n  - ${reasons.join('\n  - ')}`);
  }
  console.log('The CAMeL helper analyzed a sentence and the dictionary opened.');

  // 4. The draft release: the Installer, its blockmap, and latest.yml for the updater.
  const installer = join(root, 'release', `Arabic-Session-Word-Extractor-Setup-${version}.exe`);
  const assets = [installer, `${installer}.blockmap`, join(root, 'release', 'latest.yml')];
  for (const asset of assets) if (!existsSync(asset)) fail(`${asset} was not built.`);
  const notesFile = join(work, 'notes.md');
  writeFileSync(
    notesFile,
    `${productName} ${version}

Download **Arabic-Session-Word-Extractor-Setup-${version}.exe** below and run it. It installs for your Windows user only, without administrator permission (unless you choose a folder such as Program Files). Copies already installed update themselves.

**Windows SmartScreen:** this Installer is not code-signed yet, so the first time you run it Windows may say it "protected your PC". Choose **More info**, then **Run anyway**. This happens once.

The app has no API keys built in: add your own Soniox (or Deepgram) and Google Cloud Translation keys in Settings.
`,
  );
  execFileSync(
    'gh',
    ['release', 'create', tag, ...assets, '--repo', `${owner}/${repo}`, '--draft', '--target', commit, '--title', `${productName} ${version}`, '--notes-file', notesFile],
    { cwd: root, stdio: 'inherit' },
  );
  console.log(`\nDraft release ${tag} uploaded. Publish it on GitHub (not as a pre-release) when ready.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
