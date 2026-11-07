import { cpSync } from 'node:fs';

cpSync('src/renderer/index.html', 'dist/src/renderer/index.html');
