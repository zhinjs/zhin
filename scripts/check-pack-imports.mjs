#!/usr/bin/env node
/**
 * Pack import gate: every relative import in a publishable package's packed
 * JavaScript must resolve to a file inside the same tarball.
 *
 * @zhin.js/plugin-group-suite@1.1.8 shipped commands that imported
 * ../lib/keywords.js while tsc never emitted it (#799). Workspace tests import
 * src/ directly, so only the packed artifact shows this class of bug.
 *
 * For each non-private workspace package this script reproduces the prepack
 * step that matters for the file list (Plugin Runtime JS entries; `pnpm build`
 * must already have run), lists the tarball with
 * `npm pack --dry-run --json --ignore-scripts`, and checks:
 *   - relative import / export / dynamic import() / require() specifiers in
 *     packed .js/.mjs/.cjs files resolve to a packed file;
 *   - main / module / bin / exports targets of the *published* manifest are
 *     packed, every condition included. pnpm publish applies publishConfig
 *     overrides first, so the source-only `development` condition (stripped
 *     via publishConfig.exports, see sync-publish-exports.mjs) must not appear.
 *
 * It also checks the tarball *layout* (docs/contributing/publishing.md#发布包目录规范):
 *   - errors: `zhin.entry` of a Plugin Runtime package is packed and is JavaScript;
 *     test files (`tests/`, `__tests__/`, `*.test.*`, `*.spec.*`) are not packed;
 *   - warnings: build configuration (tsconfig, vitest/vite config, tsbuildinfo) is
 *     packed; source maps point at sources that are neither packed nor inlined
 *     (`sourcesContent`); TypeScript sources are packed although no source map refers
 *     to them (dead weight: published exports no longer have a `development` condition).
 *
 * Extensionless specifiers that only a bundler can resolve (for example
 * `./types` next to `types.js` in a browser-only Console package) are
 * reported as warnings; `--strict` turns them into failures.
 *
 * The rules live in basic/cli/shared/pack-rules.mjs so `zhin plugin check` applies the same ones
 * to a single plugin directory.
 *
 * Usage: node scripts/check-pack-imports.mjs [--filter <name>]... [--json] [--strict]
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import ts from 'typescript';
import {
  buildPluginRuntimeEntries,
  cleanPluginRuntimeEntries,
} from './build-plugin-runtime-entries.mjs';
import { readWorkspaceGraph } from './lib/workspace-graph.mjs';
import {
  entryTargets,
  findBrokenPackImports as sharedFindBrokenPackImports,
  findPackLayoutProblems,
  publishedManifest,
} from '../basic/cli/shared/pack-rules.mjs';

export { entryTargets, findPackLayoutProblems, publishedManifest };

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Relative module specifiers (static, re-export, dynamic import, require) in a JS source. */
export function relativeSpecifiers(source) {
  const { importedFiles } = ts.preProcessFile(source, true, true);
  return [...new Set(importedFiles
    .map(({ fileName }) => fileName)
    .filter((specifier) => specifier.startsWith('./') || specifier.startsWith('../')))];
}

/**
 * {@link sharedFindBrokenPackImports} with the TypeScript-based specifier scanner.
 *
 * @param {Parameters<typeof sharedFindBrokenPackImports>[0]} input
 */
export function findBrokenPackImports(input) {
  return sharedFindBrokenPackImports({ relativeSpecifiers, ...input });
}

async function listPackedFiles(dir) {
  const { stdout } = await execFileAsync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    { cwd: dir, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, npm_config_loglevel: 'error' } },
  );
  const [report] = JSON.parse(stdout);
  return report.files.map(({ path: file }) => file);
}

async function checkPackage({ name, dir }) {
  const absolute = path.join(repoRoot, dir);
  const manifest = JSON.parse(await readFile(path.join(absolute, 'package.json'), 'utf8'));
  const generatesEntries = /build-plugin-runtime-entries/u.test(manifest.scripts?.prepack ?? '');
  try {
    if (generatesEntries) {
      await cleanPluginRuntimeEntries(absolute);
      await buildPluginRuntimeEntries(absolute);
    }
    const files = await listPackedFiles(absolute);
    const input = {
      files,
      manifest,
      readFile: (file) => readFile(path.join(absolute, file), 'utf8'),
    };
    const imports = await findBrokenPackImports(input);
    const layout = await findPackLayoutProblems(input);
    return {
      name,
      dir,
      files: files.length,
      errors: [...imports.errors, ...layout.errors],
      warnings: [...imports.warnings, ...layout.warnings],
    };
  } finally {
    if (generatesEntries) await cleanPluginRuntimeEntries(absolute);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const filters = args.flatMap((arg, index) => (args[index - 1] === '--filter' ? [arg] : []));
  const json = args.includes('--json');
  const strict = args.includes('--strict');
  const started = Date.now();

  const packages = [];
  for (const node of readWorkspaceGraph().values()) {
    const manifest = JSON.parse(await readFile(path.join(repoRoot, node.dir, 'package.json'), 'utf8'));
    if (manifest.private === true) continue;
    if (filters.length > 0 && !filters.includes(node.name)) continue;
    packages.push(node);
  }
  for (const filter of filters) {
    if (!packages.some(({ name }) => name === filter)) throw new Error(`Unknown publishable package: ${filter}`);
  }

  const results = [];
  const queue = [...packages];
  const workers = Array.from({ length: Math.min(availableParallelism(), 8) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      try {
        results.push(await checkPackage(next));
      } catch (error) {
        results.push({ ...next, files: 0, errors: [`pack listing failed: ${error.message}`], warnings: [] });
      }
    }
  });
  await Promise.all(workers);
  results.sort((left, right) => left.name.localeCompare(right.name));

  const failing = (result) => result.errors.length > 0 || (strict && result.warnings.length > 0);
  const broken = results.filter(failing);
  const warned = results.filter((result) => !failing(result) && result.warnings.length > 0);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (json) {
    process.stdout.write(`${JSON.stringify({ seconds: Number(seconds), results }, null, 2)}\n`);
  } else {
    for (const { name, dir, warnings } of warned) {
      console.warn(`  warning: ${name} (${dir})`);
      for (const warning of warnings) console.warn(`    - ${warning}`);
    }
    if (broken.length > 0) {
      console.error(`Pack import check: FAILED (${broken.length}/${results.length} packages, ${seconds}s)\n`);
      for (const { name, dir, errors, warnings } of broken) {
        console.error(`  ${name} (${dir})`);
        for (const error of [...errors, ...(strict ? warnings : [])]) console.error(`    - ${error}`);
      }
      console.error('\nRun `pnpm build` first; then make sure tsc emits every module the packed files import and `files` covers it.');
      console.error('Layout rules: docs/contributing/publishing.md#发布包目录规范 (exclude tests with "!src/**/*.test.ts" in files).');
    } else {
      console.log(`Pack import check: OK (${results.length} packages, ${warned.length} with warnings, ${seconds}s)`);
    }
  }
  if (broken.length > 0) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) await main();
