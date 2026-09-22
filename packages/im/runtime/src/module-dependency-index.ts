import { access, readFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { init, parse } from 'es-module-lexer';
import { resolve as resolveImport } from 'import-meta-resolve';

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
}

/** Tracks the local import closure of every module entry loaded by the runtime. */
export class ModuleDependencyIndex {
  readonly #dependenciesByEntry = new Map<string, ReadonlySet<string>>();
  readonly #entriesByDependency = new Map<string, Set<string>>();
  readonly #commonJsSourcesByEntry = new Map<string, ReadonlySet<string>>();
  readonly #entriesByCommonJsSource = new Map<string, Set<string>>();
  readonly #commonJsByDirectory = new Map<string, Promise<boolean>>();
  readonly #dirtyEntries = new Set<string>();

  async analyze(entry: string): Promise<ModuleDependencyAnalysis> {
    const normalized = resolve(entry);
    const cached = this.#dependenciesByEntry.get(normalized);
    if (cached && !this.#dirtyEntries.has(normalized)) {
      return analysis(cached, this.#commonJsSourcesByEntry.get(normalized) ?? new Set());
    }

    await init;
    const dependencies = new Set<string>();
    const commonJsSources = new Set<string>();
    const visited = new Set<string>();
    await this.#visit(normalized, normalized, dependencies, commonJsSources, visited);
    return analysis(dependencies, commonJsSources);
  }

  commit(entry: string, result: ModuleDependencyAnalysis): void {
    const normalized = resolve(entry);
    this.#remove(normalized);
    const dependencies = new Set(result.dependencies);
    const commonJsSources = new Set(result.commonJsSources);
    this.#dependenciesByEntry.set(normalized, dependencies);
    this.#commonJsSourcesByEntry.set(normalized, commonJsSources);
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
    const normalized = resolve(source);
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
    const active = new Set(entries.map((entry) => resolve(entry)));
    for (const entry of this.#dependenciesByEntry.keys()) {
      if (!active.has(entry)) this.#remove(entry);
    }
  }

  clear(): void {
    this.#dependenciesByEntry.clear();
    this.#entriesByDependency.clear();
    this.#commonJsSourcesByEntry.clear();
    this.#entriesByCommonJsSource.clear();
    this.#commonJsByDirectory.clear();
    this.#dirtyEntries.clear();
  }

  hasCommonJsImpact(source: string): boolean {
    const normalized = resolve(source);
    if (isExplicitCommonJsSource(normalized)) return true;
    if (this.#entriesByCommonJsSource.has(normalized)) return true;
    return [...(this.#entriesByDependency.get(normalized) ?? [])].some((entry) =>
      this.#commonJsSourcesByEntry.get(entry)?.has(entry) ?? false,
    );
  }

  affectedSources(source: string): readonly string[] {
    const normalized = resolve(source);
    const entries = [...(this.#entriesByDependency.get(normalized) ?? [])].sort();
    return Object.freeze([normalized, ...entries.filter((entry) => entry !== normalized)]);
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
    this.#dirtyEntries.delete(entry);
  }

  async #visit(
    entry: string,
    source: string,
    dependencies: Set<string>,
    commonJsSources: Set<string>,
    visited: Set<string>,
  ): Promise<void> {
    if (visited.has(source)) return;
    visited.add(source);
    if (source !== entry) dependencies.add(source);
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
        await this.#visit(entry, dependency, dependencies, commonJsSources, visited);
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
): ModuleDependencyAnalysis {
  return Object.freeze({ dependencies, commonJsSources });
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
    if (await exists(candidate)) return resolve(candidate);
  }
  return undefined;
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
