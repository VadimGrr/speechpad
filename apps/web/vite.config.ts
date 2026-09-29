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
    rollupOptions: {
      input: {
        main: resolve(here, 'index.html'),
        float: resolve(here, 'float.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@speechpad/core': resolve(here, '../../packages/core/src/index.ts'),
      '@speechpad/extension-protocol': resolve(here, '../extension/src/protocol.ts'),
    },
  },
});
