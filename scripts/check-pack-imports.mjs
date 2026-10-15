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
 *   - main / module / bin / exports targets are packed (the `development`
 *     condition is skipped: it points at workspace sources on purpose).
 *
 * Extensionless specifiers that only a bundler can resolve (for example
 * `./types` next to `types.js` in a browser-only Console package) are
 * reported as warnings; `--strict` turns them into failures.
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

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const CJS_RESOLUTION_SUFFIXES = ['.js', '.cjs', '.json', '/index.js', '/index.cjs', '/index.json'];
const BUNDLER_RESOLUTION_SUFFIXES = [
  '.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json',
  '/index.mjs', '/index.js', '/index.ts', '/index.jsx', '/index.tsx',
];

/** Relative module specifiers (static, re-export, dynamic import, require) in a JS source. */
export function relativeSpecifiers(source) {
  const { importedFiles } = ts.preProcessFile(source, true, true);
  return [...new Set(importedFiles
    .map(({ fileName }) => fileName)
    .filter((specifier) => specifier.startsWith('./') || specifier.startsWith('../')))];
}

/**
 * @param {object} input
 * @param {ReadonlyArray<string>} input.files packed paths relative to the package root (posix)
 * @param {Record<string, unknown>} input.manifest package.json
 * @param {(file: string) => Promise<string>} input.readFile reads a packed file's text
 * @returns {Promise<{ errors: string[], warnings: string[] }>}
 */
export async function findBrokenPackImports({ files, manifest, readFile: read }) {
  const packed = new Set(files.map(normalizePacked));
  const errors = [];
  const warnings = [];

  for (const [field, target] of entryTargets(manifest)) {
    const file = normalizePacked(target);
    if (!packed.has(file)) errors.push(`${field} -> ${target} is not in the tarball`);
  }

  const moduleType = manifest.type === 'module' ? 'module' : 'commonjs';
  for (const file of [...packed].sort()) {
    const extension = path.posix.extname(file);
    if (!SCANNED_EXTENSIONS.has(extension)) continue;
    const isCommonJs = extension === '.cjs' || (extension === '.js' && moduleType === 'commonjs');
    const source = await read(file);
    for (const specifier of relativeSpecifiers(source)) {
      const bare = specifier.replace(/[?#].*$/u, '');
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), bare));
      if (resolved === '..' || resolved.startsWith('../')) {
        errors.push(`${file}: '${specifier}' escapes the package root`);
        continue;
      }
      const candidates = isCommonJs
        ? [resolved, ...CJS_RESOLUTION_SUFFIXES.map((suffix) => `${resolved}${suffix}`)]
        : [resolved];
      if (candidates.some((candidate) => packed.has(candidate))) continue;
      const bundlerOnly = path.posix.extname(resolved) === ''
        && BUNDLER_RESOLUTION_SUFFIXES.some((suffix) => packed.has(`${resolved}${suffix}`));
      if (bundlerOnly) {
        warnings.push(`${file}: '${specifier}' is extensionless; only a bundler can resolve it`);
      } else {
        errors.push(`${file}: '${specifier}' -> ${resolved} is not in the tarball`);
      }
    }
  }
  return { errors, warnings };
}

/** main / module / bin / exports string targets (no wildcard patterns). */
export function entryTargets(manifest) {
  const targets = [];
  for (const field of ['main', 'module']) {
    if (typeof manifest[field] === 'string') targets.push([field, manifest[field]]);
  }
  if (typeof manifest.bin === 'string') targets.push(['bin', manifest.bin]);
  else if (manifest.bin && typeof manifest.bin === 'object') {
    for (const [name, target] of Object.entries(manifest.bin)) {
      if (typeof target === 'string') targets.push([`bin.${name}`, target]);
    }
  }
  const visit = (value, trail) => {
    if (typeof value === 'string') {
      if (!value.includes('*')) targets.push([trail, value]);
    } else if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${trail}[${index}]`));
    } else if (value && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        if (key !== 'development') visit(entry, `${trail}["${key}"]`);
      }
    }
  };
  if (manifest.exports !== undefined) visit(manifest.exports, 'exports');
  return targets;
}

function normalizePacked(file) {
  return path.posix.normalize(file.replace(/^\.\//u, '').replaceAll('\\', '/'));
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
    const { errors, warnings } = await findBrokenPackImports({
      files,
      manifest,
      readFile: (file) => readFile(path.join(absolute, file), 'utf8'),
    });
    return { name, dir, files: files.length, errors, warnings };
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
    } else {
      console.log(`Pack import check: OK (${results.length} packages, ${warned.length} with warnings, ${seconds}s)`);
    }
  }
  if (broken.length > 0) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) await main();
