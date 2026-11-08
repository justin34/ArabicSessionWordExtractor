// Where `npm run dist` writes the Installer and the packaged build (win-unpacked), and
// where `npm run release` reads them. It is outside the repo on purpose: Electron-based
// editors watching the repo (VS Code, the Claude app) keep a handle open on any app.asar
// they see, and a locked app.asar stops the next build from replacing it.
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const buildOutputDir = join(process.env.LOCALAPPDATA ?? tmpdir(), 'ArabicSessionWordExtractor-build');
