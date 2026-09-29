import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  build: {
    target: 'chrome120',
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 4096,
  },
  resolve: {
    alias: {
      '@speechpad/core': resolve(here, '../../packages/core/src/index.ts'),
    },
  },
});
