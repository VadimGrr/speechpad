import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(root, 'dist');

rmSync(outdir, { recursive: true, force: true });

const shared = {
  entryPoints: [resolve(root, 'src/index.ts')],
  bundle: true,
  target: ['es2020'],
  sourcemap: true,
  logLevel: 'info',
};

await build({
  ...shared,
  format: 'iife',
  globalName: 'Speechpad',
  outfile: resolve(outdir, 'speechpad.js'),
});

await build({
  ...shared,
  format: 'esm',
  outfile: resolve(outdir, 'speechpad.esm.js'),
});

execFileSync(
  process.execPath,
  [
    resolve(root, '../../node_modules/typescript/bin/tsc'),
    '-p',
    resolve(root, 'tsconfig.json'),
    '--emitDeclarationOnly',
    '--outDir',
    outdir,
  ],
  { stdio: 'inherit' },
);
