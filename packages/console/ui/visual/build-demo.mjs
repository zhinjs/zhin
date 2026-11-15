#!/usr/bin/env node
/** Bundles visual/demo.tsx into visual/.out/ (IIFE, so the gallery opens from file://). */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
  writeFileSync(join(out, 'visual/demo.css'), await demoUtilities());
  mkdirSync(join(out, 'dist'), { recursive: true });
  copyFileSync(join(packageRoot, 'dist/styles.css'), join(out, 'dist/styles.css'));
  return join(out, 'visual/index.html');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(await buildDemo());
}

/**
 * The gallery's own layout classes, compiled the way a Tailwind consumer (the Console) does it:
 * Tailwind utilities on top of the published `dist/theme.css`, so only on-scale keys exist.
 */
async function demoUtilities() {
  const require = createRequire(join(packageRoot, 'package.json'));
  const { compile } = await import('tailwindcss');
  const input = `@import "tailwindcss/theme.css" layer(theme);\n@import "../dist/theme.css";\n@import "tailwindcss/utilities.css" layer(utilities);\n`;
  const compiler = await compile(input, {
    base: here,
    async loadStylesheet(id, base) {
      const path = id.startsWith('tailwindcss/') ? require.resolve(id) : resolve(base, id);
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
    },
  });
  const candidates = new Set();
  for (const [, , literal] of readFileSync(join(here, 'demo.tsx'), 'utf8').matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/gu)) {
    for (const token of literal.split(/\s+/u)) if (token) candidates.add(token);
  }
  return compiler.build([...candidates]);
}
