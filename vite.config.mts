import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/** The dev server needs inline scripts for hot reload, so the strict CSP only applies to built output. */
const relaxCspInDev: Plugin = {
  name: 'relax-csp-in-dev',
  apply: 'serve',
  transformIndexHtml: (html) =>
    html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ''),
};

// Builds only the renderer. Main process and core are compiled by tsc.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react(), relaxCspInDev],
  build: {
    outDir: resolve(__dirname, 'dist/src/renderer'),
    emptyOutDir: true,
  },
  server: { port: 5173, strictPort: true },
});
