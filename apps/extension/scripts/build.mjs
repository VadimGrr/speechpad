import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = resolve(root, 'dist');

const entries = [
  { name: 'background', format: 'esm' },
  { name: 'bridge', format: 'iife' },
  { name: 'inserter', format: 'iife' },
];

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const entry of entries) {
  await build({
    entryPoints: [resolve(root, 'src', `${entry.name}.entry.ts`)],
    outfile: resolve(outDir, `${entry.name}.js`),
    bundle: true,
    format: entry.format,
    target: 'chrome111',
    platform: 'browser',
    legalComments: 'none',
    minify: false,
  });
}

await cp(resolve(root, 'manifest.json'), resolve(outDir, 'manifest.json'));
console.log('extension ->', outDir);
