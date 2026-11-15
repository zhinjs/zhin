#!/usr/bin/env node
/**
 * Build of @zhin.js/console-ui:
 *   1. tsc: client/ → dist/ (ESM + .d.ts)
 *   2. dist/version.js gets the package.json version (CONSOLE_UI_VERSION)
 *   3. Tailwind 4 (the `tailwindcss` compiler; no CLI, no native scanner) compiles
 *      client/styles/styles.css → dist/styles.css (self-contained:
 *      preflight, theme, the utilities the components use, tokens, component classes)
 *   4. dist/tokens.css: the tokens alone
 *   5. dist/exports.json: the runtime named exports of the root entry (read by
 *      @zhin.js/pagemanager when it proxies this package to plugin pages)
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(packageRoot, 'dist');
const require = createRequire(join(packageRoot, 'package.json'));
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));

function run(command, args) {
  const result = spawnSync(process.execPath, [command, ...args], { cwd: packageRoot, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

run(require.resolve('typescript/bin/tsc'), ['-p', 'tsconfig.json']);

writeFileSync(
  join(dist, 'version.js'),
  `/** Published version of @zhin.js/console-ui (written by scripts/build.mjs). */\nexport const CONSOLE_UI_VERSION = ${JSON.stringify(manifest.version)};\n`,
);

writeFileSync(join(dist, 'styles.css'), await compileStyles());
copyFileSync(join(packageRoot, 'client/styles/tokens.css'), join(dist, 'tokens.css'));

const ts = require('typescript');
const program = ts.createProgram([join(packageRoot, 'client/index.ts')], {
  jsx: ts.JsxEmit.ReactJSX,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
  skipLibCheck: true,
  noEmit: true,
});
const checker = program.getTypeChecker();
const entry = program.getSourceFile(join(packageRoot, 'client/index.ts'));
const moduleSymbol = entry && checker.getSymbolAtLocation(entry);
if (!moduleSymbol) throw new Error('Cannot read the exports of client/index.ts');
const names = checker.getExportsOfModule(moduleSymbol)
  .filter((symbol) => {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    return (target.flags & ts.SymbolFlags.Value) !== 0;
  })
  .map((symbol) => symbol.getName())
  .sort();
writeFileSync(
  join(dist, 'exports.json'),
  `${JSON.stringify({ name: manifest.name, version: manifest.version, exports: names }, null, 2)}\n`,
);
console.log(`@zhin.js/console-ui ${manifest.version}: ${names.length} runtime exports, dist/styles.css, dist/tokens.css`);

/**
 * Tailwind 4 compile of client/styles/styles.css. Candidates are the whitespace-separated words of
 * every string literal in the component sources (Tailwind ignores the ones that are not classes), so the output holds exactly the
 * utilities the components can use; consumers never scan this package.
 */
async function compileStyles() {
  const { compile } = await import('tailwindcss');
  const input = join(packageRoot, 'client/styles/styles.css');
  const resolveFrom = (id, base) => {
    if (id.startsWith('.') || id.startsWith('/')) return resolve(base, id);
    if (id === 'tailwindcss') return require.resolve('tailwindcss/index.css');
    return createRequire(join(base, 'noop.js')).resolve(id);
  };
  const compiler = await compile(readFileSync(input, 'utf8'), {
    base: dirname(input),
    async loadStylesheet(id, base) {
      const path = resolveFrom(id, base);
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
    },
    async loadModule(id, base) {
      const path = resolveFrom(id, base);
      const module = await import(pathToFileURL(path).href);
      return { path, base: dirname(path), module: module.default ?? module };
    },
  });
  const candidates = new Set();
  for (const file of sourceFiles(join(packageRoot, 'client'))) {
    // Class names only live in string literals (className, cva, cn arguments).
    for (const [, , literal] of readFileSync(file, 'utf8').matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/gu)) {
      for (const token of literal.split(/\s+/u)) if (token) candidates.add(token);
    }
  }
  return compiler.build([...candidates]);
}

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [path] : [];
  });
}
