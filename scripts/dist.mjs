// `npm run dist`: builds the Windows x64 Installer (GLOSSARY: Installer) into the build
// output folder (scripts/buildOutput.mjs, outside the repo).
// The CAMeL helper and the dictionary are built first when vendor/ lacks them, since the
// Installer bundles both; then the app, then electron-builder's NSIS target.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildOutputDir } from './buildOutput.mjs';

const root = resolve(import.meta.dirname, '..');
const run = (command) => execSync(command, { cwd: root, stdio: 'inherit' });

if (!existsSync(join(root, 'vendor', 'camel-helper', 'python', 'python.exe'))) run('npm run build:helper');
if (!existsSync(join(root, 'vendor', 'dictionary', 'dictionary.db'))) run('npm run build:dictionary');
run('npm run build');
// Publishing is the release script's job (a draft, after checking the packaged build).
run(`npx electron-builder --win nsis --x64 --publish never --config.directories.output="${buildOutputDir}"`);
console.log(`
Installer and packaged build: ${buildOutputDir}`);
