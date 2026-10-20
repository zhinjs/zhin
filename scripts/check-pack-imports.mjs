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

  for (const [field, target] of entryTargets(publishedManifest(manifest))) {
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

const TEST_FILE = /(^|\/)(tests|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/u;
const BUILD_CONFIG = /(^|\/)(tsconfig[^/]*\.json|(vitest|vite|tsup|rollup|eslint)\.config\.[^/]+|\.eslintrc[^/]*)$|\.tsbuildinfo$/u;
const TYPESCRIPT_SOURCE = /\.(ts|tsx|mts|cts)$/u;
const DECLARATION = /\.d\.[cm]?ts$/u;
const RUNTIME_ENTRY = /\.[cm]?js$/u;

/**
 * Tarball layout rules (see docs/contributing/publishing.md#发布包目录规范).
 *
 * @param {object} input same shape as {@link findBrokenPackImports}
 * @returns {Promise<{ errors: string[], warnings: string[] }>}
 */
export async function findPackLayoutProblems({ files, manifest, readFile: read }) {
  const packed = [...new Set(files.map(normalizePacked))].sort();
  const packedSet = new Set(packed);
  const errors = [];
  const warnings = [];

  const entry = manifest.zhin && typeof manifest.zhin === 'object' ? manifest.zhin.entry : undefined;
  if (typeof entry === 'string') {
    const file = normalizePacked(entry);
    if (!RUNTIME_ENTRY.test(file)) errors.push(`zhin.entry -> ${entry} is not JavaScript`);
    else if (!packedSet.has(file)) errors.push(`zhin.entry -> ${entry} is not in the tarball`);
  }

  const tests = packed.filter((file) => TEST_FILE.test(file));
  if (tests.length > 0) errors.push(`layout: ${tests.length} test file(s) packed, e.g. ${tests.slice(0, 3).join(', ')}`);

  const configs = packed.filter((file) => BUILD_CONFIG.test(file));
  if (configs.length > 0) warnings.push(`layout: build configuration packed: ${configs.slice(0, 3).join(', ')}`);

  const referenced = new Set();
  let unresolvedMaps = 0;
  let unresolvedDeclarationMaps = 0;
  let firstUnresolved;
  for (const file of packed.filter((name) => name.endsWith('.map'))) {
    let map;
    try {
      map = JSON.parse(await read(file));
    } catch {
      continue;
    }
    const base = path.posix.join(path.posix.dirname(file), typeof map.sourceRoot === 'string' ? map.sourceRoot : '');
    const sources = Array.isArray(map.sources) ? map.sources.filter((source) => typeof source === 'string') : [];
    const inlined = Array.isArray(map.sourcesContent)
      && sources.every((_, index) => typeof map.sourcesContent[index] === 'string');
    const declarationMap = file.endsWith('.d.ts.map') || file.endsWith('.d.mts.map') || file.endsWith('.d.cts.map');
    for (const source of sources) {
      if (/^[a-z]+:/iu.test(source)) continue;
      const resolved = path.posix.normalize(path.posix.join(base, source));
      referenced.add(resolved);
      // Editors open declaration-map sources from disk; inlined content only helps JS debuggers.
      if (packedSet.has(resolved) || (inlined && !declarationMap)) continue;
      if (declarationMap) unresolvedDeclarationMaps += 1;
      else unresolvedMaps += 1;
      firstUnresolved ??= `${file} -> ${resolved}`;
    }
  }
  if (unresolvedMaps + unresolvedDeclarationMaps > 0) {
    warnings.push(`layout: ${unresolvedMaps} source map / ${unresolvedDeclarationMaps} declaration map source(s) not packed or inlined, e.g. ${firstUnresolved}`);
  }

  const deadSources = packed.filter((file) => TYPESCRIPT_SOURCE.test(file) && !TEST_FILE.test(file) && !DECLARATION.test(file) && !referenced.has(file));
  if (deadSources.length > 0) {
    warnings.push(`layout: ${deadSources.length} TypeScript source file(s) packed without a source map referring to them, e.g. ${deadSources.slice(0, 2).join(', ')}`);
  }
  return { errors, warnings };
}

/** Fields pnpm publish replaces with their publishConfig value when packing. */
const PUBLISH_CONFIG_OVERRIDES = ['main', 'module', 'types', 'typings', 'bin', 'exports', 'browser'];

/** The manifest as `pnpm publish` writes it into the tarball. */
export function publishedManifest(manifest) {
  const publishConfig = manifest.publishConfig;
  if (!publishConfig || typeof publishConfig !== 'object') return manifest;
  const overrides = {};
  for (const field of PUBLISH_CONFIG_OVERRIDES) {
    if (publishConfig[field] !== undefined) overrides[field] = publishConfig[field];
  }
  return { ...manifest, ...overrides };
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
        visit(entry, `${trail}["${key}"]`);
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
