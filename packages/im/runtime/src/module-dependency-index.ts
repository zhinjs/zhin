import { normalizeSourcePath } from './source-path.js';
import { access, readFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { init, parse } from 'es-module-lexer';
import { moduleResolve, resolve as resolveImport } from 'import-meta-resolve';

const executableExtensions = Object.freeze([
  '.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx',
]);
const sourceAlternatives: Readonly<Record<string, readonly string[]>> = Object.freeze({
  '.js': Object.freeze(['.ts', '.tsx', '.mts', '.cts', '.js']),
  '.jsx': Object.freeze(['.tsx', '.jsx']),
  '.cjs': Object.freeze(['.cts', '.cjs']),
  '.mjs': Object.freeze(['.mts', '.mjs']),
});

export interface ModuleDependencyAnalysis {
  readonly dependencies: ReadonlySet<string>;
  readonly commonJsSources: ReadonlySet<string>;
  /**
   * Dependencies reached through package-name imports (#1250 `hmr-stale-cross-package-import`),
   * with the file each package-name import resolved to along the way. A dependency missing here
   * is reached through relative / `#` / file imports only.
   */
  readonly crossings?: ReadonlyMap<string, readonly string[]>;
}

/** Decides whether a module imported by package name is reloaded together with its importer. */
export type RevisionablePredicate = (source: string) => boolean;

export interface ModuleDependencyIndexOptions {
  /**
   * Whether a package-name import that resolved to this project source is followed (#1250).
   * Without it every resolution outside `node_modules` is followed. The module runtime limits it
   * to its watch roots: a workspace-linked framework package outside them (pnpm symlinks realpath
   * into the framework sources) never reports a change, so walking it only costs startup time.
   */
  readonly followPackageImport?: (source: string) => boolean;
}

/** Tracks the local import closure of every module entry loaded by the runtime. */
export class ModuleDependencyIndex {
  readonly #followPackageImport?: (source: string) => boolean;

  constructor(options: ModuleDependencyIndexOptions = {}) {
    this.#followPackageImport = options.followPackageImport;
  }

  readonly #dependenciesByEntry = new Map<string, ReadonlySet<string>>();
  readonly #entriesByDependency = new Map<string, Set<string>>();
  readonly #commonJsSourcesByEntry = new Map<string, ReadonlySet<string>>();
  readonly #entriesByCommonJsSource = new Map<string, Set<string>>();
  readonly #commonJsByDirectory = new Map<string, Promise<boolean>>();
  readonly #dirtyEntries = new Set<string>();
  readonly #crossingsByEntry = new Map<string, ReadonlyMap<string, readonly string[]>>();

  async analyze(entry: string): Promise<ModuleDependencyAnalysis> {
    const normalized = normalizeSourcePath(entry);
    const cached = this.#dependenciesByEntry.get(normalized);
    if (cached && !this.#dirtyEntries.has(normalized)) {
      return analysis(cached, this.#commonJsSourcesByEntry.get(normalized) ?? new Set(),
        this.#crossingsByEntry.get(normalized) ?? new Map());
    }

    await init;
    const dependencies = new Set<string>();
    const commonJsSources = new Set<string>();
    const crossings = new Map<string, readonly string[]>();
    const visited = new Set<string>();
    await this.#visit(normalized, normalized, dependencies, commonJsSources, crossings, visited, []);
    return analysis(dependencies, commonJsSources, crossings);
  }

  commit(entry: string, result: ModuleDependencyAnalysis): void {
    const normalized = normalizeSourcePath(entry);
    this.#remove(normalized);
    const dependencies = new Set(result.dependencies);
    const commonJsSources = new Set(result.commonJsSources);
    this.#dependenciesByEntry.set(normalized, dependencies);
    this.#commonJsSourcesByEntry.set(normalized, commonJsSources);
    this.#crossingsByEntry.set(normalized, new Map(result.crossings ?? []));
    this.#dirtyEntries.delete(normalized);
    for (const dependency of dependencies) {
      addReverseEntry(this.#entriesByDependency, dependency, normalized);
    }
    for (const source of commonJsSources) {
      addReverseEntry(this.#entriesByCommonJsSource, source, normalized);
    }
  }

  /** Marks the changed entry and every entry importing it for lazy re-analysis. */
  invalidate(source: string): void {
    const normalized = normalizeSourcePath(source);
    if (basename(normalized) === 'package.json') {
      this.#commonJsByDirectory.clear();
      const packageRoot = dirname(normalized);
      for (const [entry, dependencies] of this.#dependenciesByEntry) {
        if (
          isWithin(packageRoot, entry)
          || [...dependencies].some((dependency) => isWithin(packageRoot, dependency))
        ) {
          this.#dirtyEntries.add(entry);
        }
      }
    }
    if (this.#dependenciesByEntry.has(normalized)) this.#dirtyEntries.add(normalized);
    for (const entry of this.#entriesByDependency.get(normalized) ?? []) {
      this.#dirtyEntries.add(entry);
    }
  }

  /** Drops entries that no longer belong to the successfully committed generation. */
  retain(entries: readonly string[]): void {
    const active = new Set(entries.map((entry) => normalizeSourcePath(entry)));
    for (const entry of this.#dependenciesByEntry.keys()) {
      if (!active.has(entry)) this.#remove(entry);
    }
  }

  /** Marks every entry for re-analysis on its next load (e.g. the followed package roots changed). */
  invalidateAll(): void {
    for (const entry of this.#dependenciesByEntry.keys()) this.#dirtyEntries.add(entry);
  }

  clear(): void {
    this.#dependenciesByEntry.clear();
    this.#entriesByDependency.clear();
    this.#commonJsSourcesByEntry.clear();
    this.#entriesByCommonJsSource.clear();
    this.#commonJsByDirectory.clear();
    this.#dirtyEntries.clear();
    this.#crossingsByEntry.clear();
  }

  hasCommonJsImpact(source: string): boolean {
    const normalized = normalizeSourcePath(source);
    if (isExplicitCommonJsSource(normalized)) return true;
    if (this.#entriesByCommonJsSource.has(normalized)) return true;
    return [...(this.#entriesByDependency.get(normalized) ?? [])].some((entry) =>
      this.#commonJsSourcesByEntry.get(entry)?.has(entry) ?? false,
    );
  }

  /**
   * The source and every loaded entry that re-imports it on reload. Without `revisionable`, a
   * dependency reached through a package-name import is counted as reloadable.
   */
  affectedSources(source: string, revisionable?: RevisionablePredicate): readonly string[] {
    const normalized = normalizeSourcePath(source);
    const entries = [...(this.#entriesByDependency.get(normalized) ?? [])]
      .filter((entry) => !revisionable || this.#reloadsThrough(entry, normalized, revisionable))
      .sort();
    return Object.freeze([normalized, ...entries.filter((entry) => entry !== normalized)]);
  }

  /**
   * Loaded entries that import the source only through a package-name import of a package that
   * is not reloaded with its importers (#1250): a reload keeps their old module instance.
   */
  staleDependents(source: string, revisionable: RevisionablePredicate): readonly string[] {
    const normalized = normalizeSourcePath(source);
    return Object.freeze([...(this.#entriesByDependency.get(normalized) ?? [])]
      .filter((entry) => entry !== normalized && !this.#reloadsThrough(entry, normalized, revisionable))
      .sort());
  }

  /**
   * Package-name import targets (#1250) to load fresh when `source` changes: the targets on the
   * recorded import paths to it, and every target in a package that contains a changed file
   * (`packageOf`). Targets of packages that did not change are left out: they keep one instance.
   */
  changedPackageImportTargets(
    source: string,
    packageOf: (file: string) => string | undefined,
  ): readonly string[] {
    const normalized = normalizeSourcePath(source);
    const result = new Set<string>();
    const changedPackage = packageOf(normalized);
    for (const crossings of this.#crossingsByEntry.values()) {
      for (const hop of crossings.get(normalized) ?? []) {
        if (packageOf(hop)) result.add(hop);
      }
      if (!changedPackage) continue;
      for (const hops of crossings.values()) {
        for (const hop of hops) if (packageOf(hop) === changedPackage) result.add(hop);
      }
    }
    return Object.freeze([...result].sort());
  }

  #reloadsThrough(entry: string, dependency: string, revisionable: RevisionablePredicate): boolean {
    const hops = this.#crossingsByEntry.get(entry)?.get(dependency);
    return !hops || hops.every((hop) => revisionable(hop));
  }

  #remove(entry: string): void {
    for (const dependency of this.#dependenciesByEntry.get(entry) ?? []) {
      removeReverseEntry(this.#entriesByDependency, dependency, entry);
    }
    for (const source of this.#commonJsSourcesByEntry.get(entry) ?? []) {
      removeReverseEntry(this.#entriesByCommonJsSource, source, entry);
    }
    this.#dependenciesByEntry.delete(entry);
    this.#commonJsSourcesByEntry.delete(entry);
    this.#crossingsByEntry.delete(entry);
    this.#dirtyEntries.delete(entry);
  }

  async #visit(
    entry: string,
    source: string,
    dependencies: Set<string>,
    commonJsSources: Set<string>,
    crossings: Map<string, readonly string[]>,
    visited: Set<string>,
    hops: readonly string[],
  ): Promise<void> {
    if (visited.has(source)) return;
    visited.add(source);
    if (source !== entry) {
      dependencies.add(source);
      if (hops.length > 0) crossings.set(source, Object.freeze([...hops]));
    }
    if (!executableExtensions.includes(extname(source))) return;
    let text: string;
    try {
      text = await readFile(source, 'utf8');
    } catch {
      return;
    }
    const commonJs = await this.#isCommonJsSource(source);
    if (commonJs) commonJsSources.add(source);
    const specifiers = commonJs ? commonJsSpecifiers(text) : [];
    try {
      const [imports] = parse(text, source);
      specifiers.push(...imports.flatMap((imported) => imported.n ? [imported.n] : []));
    } catch {
      // Import analysis is an HMR optimization. Module loading remains the
      // authority for syntax diagnostics and must not be hidden by the index.
      // CommonJS requires were already collected by the tolerant lexer above.
      if (!commonJs) return;
    }
    for (const specifier of specifiers) {
      const dependency = await resolveLocalImport(source, specifier);
      if (dependency) {
        await this.#visit(entry, dependency, dependencies, commonJsSources, crossings, visited, hops);
        continue;
      }
      const packaged = resolvePackageImport(source, specifier);
      if (packaged && (this.#followPackageImport?.(packaged) ?? true)) {
        await this.#visit(entry, packaged, dependencies, commonJsSources, crossings, visited, [...hops, packaged]);
      }
    }
  }

  #isCommonJsSource(source: string): Promise<boolean> {
    if (isExplicitCommonJsSource(source)) return Promise.resolve(true);
    if (['.mjs', '.mts'].includes(extname(source))) return Promise.resolve(false);
    const directory = dirname(source);
    const cached = this.#commonJsByDirectory.get(directory);
    if (cached) return cached;
    const detected = findCommonJsPackage(directory);
    this.#commonJsByDirectory.set(directory, detected);
    return detected;
  }
}

function analysis(
  dependencies: ReadonlySet<string>,
  commonJsSources: ReadonlySet<string>,
  crossings: ReadonlyMap<string, readonly string[]>,
): ModuleDependencyAnalysis {
  return Object.freeze({ dependencies, commonJsSources, crossings });
}

function addReverseEntry(index: Map<string, Set<string>>, source: string, entry: string): void {
  const entries = index.get(source) ?? new Set<string>();
  entries.add(entry);
  index.set(source, entries);
}

function removeReverseEntry(index: Map<string, Set<string>>, source: string, entry: string): void {
  const entries = index.get(source);
  entries?.delete(entry);
  if (entries?.size === 0) index.delete(source);
}

/** Collects literal require()/require.resolve() calls outside comments and literal text. */
function commonJsSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '"' || character === "'") {
      index = skipQuoted(source, index, character);
      continue;
    }
    if (character === '`') {
      index = skipTemplate(source, index);
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index + 2);
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index + 2);
      continue;
    }
    if (!isIdentifierStart(character)) {
      index += 1;
      continue;
    }
    const start = index;
    index = skipIdentifier(source, index + 1);
    if (source.slice(start, index) !== 'require' || previousSignificant(source, start) === '.') {
      continue;
    }
    const call = readRequireCall(source, index);
    if (!call) continue;
    specifiers.push(call.specifier);
    index = call.end;
  }
  return specifiers;
}

function readRequireCall(
  source: string,
  start: number,
): { readonly specifier: string; readonly end: number } | undefined {
  let index = skipTrivia(source, start);
  if (source[index] === '.') {
    index = skipTrivia(source, index + 1);
    const identifierStart = index;
    index = skipIdentifier(source, index);
    if (source.slice(identifierStart, index) !== 'resolve') return undefined;
    index = skipTrivia(source, index);
  }
  if (source[index] !== '(') return undefined;
  index = skipTrivia(source, index + 1);
  const quote = source[index];
  if (quote !== '"' && quote !== "'") return undefined;
  const literal = readStringLiteral(source, index, quote);
  if (!literal) return undefined;
  index = skipTrivia(source, literal.end);
  if (source[index] !== ')') return undefined;
  return { specifier: literal.value, end: index + 1 };
}

function readStringLiteral(
  source: string,
  start: number,
  quote: '"' | "'",
): { readonly value: string; readonly end: number } | undefined {
  let value = '';
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === quote) return { value, end: index + 1 };
    if (character === '\\') {
      const escaped = source[index + 1];
      if (!escaped || escaped === '\n' || escaped === '\r') return undefined;
      value += escaped;
      index += 2;
      continue;
    }
    if (character === '\n' || character === '\r') return undefined;
    value += character;
    index += 1;
  }
  return undefined;
}

function skipTrivia(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    if (/\s/u.test(source[index] ?? '')) {
      index += 1;
    } else if (source[index] === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index + 2);
    } else if (source[index] === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index + 2);
    } else {
      break;
    }
  }
  return index;
}

function skipQuoted(source: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === '\\') index += 2;
    else if (source[index] === quote) return index + 1;
    else index += 1;
  }
  return source.length;
}

function skipTemplate(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === '\\') index += 2;
    else if (source[index] === '`') return index + 1;
    else index += 1;
  }
  return source.length;
}

function skipLineComment(source: string, start: number): number {
  const end = source.indexOf('\n', start);
  return end < 0 ? source.length : end + 1;
}

function skipBlockComment(source: string, start: number): number {
  const end = source.indexOf('*/', start);
  return end < 0 ? source.length : end + 2;
}

function isIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_$]/u.test(character);
}

function skipIdentifier(source: string, start: number): number {
  let index = start;
  while (/[\w$]/u.test(source[index] ?? '')) index += 1;
  return index;
}

function previousSignificant(source: string, start: number): string | undefined {
  let index = start - 1;
  while (index >= 0 && /\s/u.test(source[index] ?? '')) index -= 1;
  return source[index];
}

function isExplicitCommonJsSource(source: string): boolean {
  return ['.cjs', '.cts'].includes(extname(source));
}

async function findCommonJsPackage(start: string): Promise<boolean> {
  let directory = start;
  while (true) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
        readonly type?: unknown;
      };
      return manifest.type !== 'module';
    } catch {
      const parent = dirname(directory);
      if (parent === directory) return true;
      directory = parent;
    }
  }
}

async function resolveLocalImport(importer: string, specifier: string): Promise<string | undefined> {
  let requested: string;
  try {
    if (specifier.startsWith('file:')) requested = fileURLToPath(specifier);
    else if (isAbsolute(specifier)) requested = specifier;
    else if (specifier.startsWith('.')) requested = resolve(dirname(importer), specifier);
    else if (specifier.startsWith('#')) {
      const resolvedImport = resolveImport(specifier, pathToFileURL(importer).href);
      if (resolvedImport.startsWith('node:')) return undefined;
      requested = fileURLToPath(resolvedImport);
    }
    else return undefined;
  } catch {
    return undefined;
  }
  for (const candidate of importCandidates(requested)) {
    if (await exists(candidate)) return normalizeSourcePath(candidate);
  }
  return undefined;
}

/**
 * A package-name import that Node resolves (with this process's conditions, symlinks followed)
 * to a project source outside `node_modules` — a workspace or `file:` package (#1250).
 * Installed packages are never tracked: they are not watched and need a restart to change.
 */
function resolvePackageImport(importer: string, specifier: string): string | undefined {
  if (!isPackageSpecifier(specifier)) return undefined;
  let resolved: URL;
  try {
    resolved = moduleResolve(specifier, pathToFileURL(importer), activeConditions());
  } catch {
    return undefined;
  }
  if (resolved.protocol !== 'file:') return undefined;
  const path = normalizeSourcePath(fileURLToPath(resolved));
  if (path.split(/[\\/]/u).includes('node_modules')) return undefined;
  return path;
}

function isPackageSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('#') && !specifier.startsWith('/')
    && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(specifier) && !isAbsolute(specifier);
}

let conditions: Set<string> | undefined;

/** Node's default ESM conditions plus `--conditions` / `-C` from the command line and NODE_OPTIONS. */
function activeConditions(): Set<string> {
  if (conditions) return conditions;
  const result = new Set(['node', 'import']);
  const args = [...process.execArgv, ...(process.env.NODE_OPTIONS?.split(/\s+/u) ?? [])];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    const inline = /^(?:--conditions|-C)=(.+)$/u.exec(arg);
    if (inline?.[1]) result.add(inline[1]);
    else if ((arg === '--conditions' || arg === '-C') && args[index + 1]) result.add(args[++index]!);
  }
  conditions = result;
  return result;
}

function importCandidates(requested: string): readonly string[] {
  const extension = extname(requested);
  if (extension) {
    const alternatives = sourceAlternatives[extension];
    if (!alternatives) return [requested];
    const stem = requested.slice(0, -extension.length);
    return [
      requested,
      ...alternatives
        .filter((candidate) => candidate !== extension)
        .map((candidate) => `${stem}${candidate}`),
    ];
  }
  return [
    requested,
    ...executableExtensions.map((candidate) => `${requested}${candidate}`),
    ...executableExtensions.map((candidate) => resolve(requested, `index${candidate}`)),
  ];
}

function isWithin(root: string, source: string): boolean {
  const child = relative(root, source);
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

async function exists(source: string): Promise<boolean> {
  try {
    await access(source);
    return true;
  } catch {
    return false;
  }
}
