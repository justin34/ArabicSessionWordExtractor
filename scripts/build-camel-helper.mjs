// Builds the Arabic analysis helper bundle, following spike #2 (scripts/spikes/camel-no-torch/):
// the official Windows embeddable Python, a site-packages folder holding camel-tools installed
// with --no-deps plus its light runtime deps, and a data folder with only the two MSA packages.
//
//   vendor/camel-helper/
//     python/          embeddable Python 3.13 (python313._pth points at ../site-packages)
//     site-packages/   camel-tools (pinned, --no-deps) + helper/camel/requirements.txt
//     data/            CAMELTOOLS_DATA: morphology-db-msa-r13 + disambig-mle-calima-msa-r13
//     analyze.py       the helper itself, copied from helper/camel/
//
// Needs `py -3.13` (with pip) on the build machine, used only to install wheels for cp313.
// Re-running is safe: finished steps are skipped. Pass --clean to start over.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PYTHON_VERSION = '3.13.6';
const CAMEL_TOOLS_VERSION = '1.6.0';
const MLE_PACKAGE = 'disambig-mle-calima-msa-r13'; // pulls in morphology-db-msa-r13

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'helper', 'camel');
const out = join(root, 'vendor', 'camel-helper');
const pythonDir = join(out, 'python');
const sitePackages = join(out, 'site-packages');
const dataDir = join(out, 'data');
const pythonExe = join(pythonDir, 'python.exe');

function run(cmd, args, env = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
}

if (process.argv.includes('--clean')) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. Embeddable Python.
if (!existsSync(pythonExe)) {
  const zip = join(out, `python-${PYTHON_VERSION}-embed-amd64.zip`);
  const url = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`;
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
  mkdirSync(pythonDir, { recursive: true });
  run('py', ['-3.13', '-m', 'zipfile', '-e', zip, pythonDir]);
  rmSync(zip);
}
// The embeddable runtime ignores PYTHONPATH and site; its ._pth file is the whole search path.
const pth = join(pythonDir, `python${PYTHON_VERSION.split('.').slice(0, 2).join('')}._pth`);
const pthLines = readFileSync(pth, 'utf8').split(/\r?\n/).filter(Boolean);
if (!pthLines.includes('../site-packages')) {
  writeFileSync(pth, [...pthLines.filter((l) => l !== '#import site'), '../site-packages', ''].join('\r\n'));
}

// 2. site-packages: camel-tools without torch, transformers or the scientific stack.
if (!existsSync(join(sitePackages, 'camel_tools'))) {
  const pip = ['-3.13', '-m', 'pip', 'install', '--disable-pip-version-check', '--target', sitePackages];
  run('py', [...pip, '--no-deps', `camel-tools==${CAMEL_TOOLS_VERSION}`]);
  run('py', [...pip, '-r', join(source, 'requirements.txt')]);
}

// 3. MSA data only (not `light`, which pulls every dialect: 536 MB).
const helperEnv = { CAMELTOOLS_DATA: dataDir, PYTHONIOENCODING: 'utf-8' };
if (!existsSync(join(dataDir, 'data', 'disambig_mle', 'calima-msa-r13'))) {
  mkdirSync(dataDir, { recursive: true });
  run(
    pythonExe,
    [
      '-W',
      'ignore::SyntaxWarning',
      '-c',
      `from camel_tools.data import CATALOGUE as C; C.download_package('${MLE_PACKAGE}', recursive=True)`,
    ],
    helperEnv,
  );
}

// 4. The helper script, and the spike's guard that no heavy package is imported.
copyFileSync(join(source, 'analyze.py'), join(out, 'analyze.py'));
run(pythonExe, ['-W', 'ignore::SyntaxWarning', join(root, 'scripts', 'spikes', 'camel-no-torch', 'smoke.py')], helperEnv);
console.log(`\nArabic analysis helper ready in ${out}`);
