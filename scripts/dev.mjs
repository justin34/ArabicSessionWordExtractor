// Dev loop: compile main/core, start the Vite dev server (hot reload) and point Electron at it.
import { execSync, spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';

execSync('npx tsc -p tsconfig.build.json', { stdio: 'inherit' });
const server = await createServer();
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5173/';

const child = spawn(String(electron), ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
child.on('exit', async () => {
  await server.close();
  process.exit(0);
});
