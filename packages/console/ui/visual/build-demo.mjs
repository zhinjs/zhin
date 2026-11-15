#!/usr/bin/env node
/** Bundles visual/demo.tsx into visual/.out/ (IIFE, so the gallery opens from file://). */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const out = join(here, '.out');

export async function buildDemo() {
  if (!existsSync(join(packageRoot, 'dist/styles.css'))) {
    throw new Error('dist/styles.css is missing: run `pnpm --filter @zhin.js/console-ui build` first.');
  }
  mkdirSync(join(out, 'visual'), { recursive: true });
  await build({
    entryPoints: [join(here, 'demo.tsx')],
    outfile: join(out, 'visual/demo.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'warning',
  });
  copyFileSync(join(here, 'index.html'), join(out, 'visual/index.html'));
  mkdirSync(join(out, 'dist'), { recursive: true });
  copyFileSync(join(packageRoot, 'dist/styles.css'), join(out, 'dist/styles.css'));
  return join(out, 'visual/index.html');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(await buildDemo());
}
