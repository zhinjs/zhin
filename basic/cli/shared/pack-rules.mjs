/**
 * Tarball rules shared by `pnpm check:pack-imports` (scripts/check-pack-imports.mjs, every
 * workspace package) and `zhin plugin check` (one plugin directory).
 *
 * Plain JavaScript on purpose: the repository script imports it without building @zhin.js/cli,
 * and the CLI ships it as-is (see `files`). Types live in pack-rules.d.mts.
 *
 * Rules (docs/contributing/publishing.md#发布包目录规范):
 *   - relative imports in packed .js/.mjs/.cjs resolve to packed files;
 *   - main / module / bin / exports targets of the published manifest are packed;
 *   - `zhin.entry` is packed JavaScript; test files are not packed;
 *   - warnings for packed build configuration, unresolved source maps and dead TypeScript sources.
 */
import * as path from 'node:path';

const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const CJS_RESOLUTION_SUFFIXES = ['.js', '.cjs', '.json', '/index.js', '/index.cjs', '/index.json'];
const BUNDLER_RESOLUTION_SUFFIXES = [
  '.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json',
  '/index.mjs', '/index.js', '/index.ts', '/index.jsx', '/index.tsx',
];


const RELATIVE_SPECIFIER_PATTERNS = [
  /\b(?:import|export)\s[^'"`;]*?\bfrom\s*(['"])([^'"\n]+)\1/gu,
  /\bimport\s*(['"])([^'"\n]+)\1/gu,
  /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/gu,
  /\brequire\s*\(\s*(['"])([^'"\n]+)\1\s*\)/gu,
];

/**
 * Dependency-free scan for relative specifiers (static import / re-export / import() / require()).
 * Approximate: it does not skip comments or strings. Callers that have `typescript` should pass a
 * `ts.preProcessFile` based scanner instead (the repository script does).
 *
 * @param {string} source
 * @returns {string[]}
 */
export function scanRelativeSpecifiers(source) {
  const specifiers = [];
  for (const pattern of RELATIVE_SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[2];
      if (specifier.startsWith('./') || specifier.startsWith('../')) specifiers.push(specifier);
    }
  }
  return [...new Set(specifiers)];
}

/**
 * @param {object} input
 * @param {ReadonlyArray<string>} input.files packed paths relative to the package root (posix)
 * @param {Record<string, unknown>} input.manifest package.json
 * @param {(file: string) => Promise<string>} input.readFile reads a packed file's text
 * @param {(source: string) => string[]} [input.relativeSpecifiers] lists relative specifiers; defaults to {@link scanRelativeSpecifiers}
 * @returns {Promise<{ errors: string[], warnings: string[] }>}
 */
export async function findBrokenPackImports({
  files,
  manifest,
  readFile: read,
  relativeSpecifiers = scanRelativeSpecifiers,
}) {
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

export function normalizePacked(file) {
  return path.posix.normalize(file.replace(/^\.\//u, '').replaceAll('\\', '/'));
}
