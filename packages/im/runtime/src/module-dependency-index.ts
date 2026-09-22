import { access, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { init, parse } from 'es-module-lexer';

const executableExtensions = Object.freeze([
  '.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx',
]);
const sourceAlternatives: Readonly<Record<string, readonly string[]>> = Object.freeze({
  '.js': Object.freeze(['.ts', '.tsx', '.js']),
  '.jsx': Object.freeze(['.tsx', '.jsx']),
  '.cjs': Object.freeze(['.cts', '.cjs']),
  '.mjs': Object.freeze(['.mts', '.mjs']),
});

/** Tracks the local import closure of every module entry loaded by the runtime. */
export class ModuleDependencyIndex {
  readonly #dependenciesByEntry = new Map<string, ReadonlySet<string>>();
  readonly #entriesByDependency = new Map<string, Set<string>>();

  async analyze(entry: string): Promise<ReadonlySet<string>> {
    await init;
    const normalized = resolve(entry);
    const dependencies = new Set<string>();
    const visited = new Set<string>();
    await this.#visit(normalized, normalized, dependencies, visited);
    return dependencies;
  }

  commit(entry: string, dependencies: ReadonlySet<string>): void {
    const normalized = resolve(entry);
    for (const dependency of this.#dependenciesByEntry.get(normalized) ?? []) {
      const entries = this.#entriesByDependency.get(dependency);
      entries?.delete(normalized);
      if (entries?.size === 0) this.#entriesByDependency.delete(dependency);
    }
    const snapshot = new Set(dependencies);
    this.#dependenciesByEntry.set(normalized, snapshot);
    for (const dependency of snapshot) {
      const entries = this.#entriesByDependency.get(dependency) ?? new Set<string>();
      entries.add(normalized);
      this.#entriesByDependency.set(dependency, entries);
    }
  }

  affectedSources(source: string): readonly string[] {
    const normalized = resolve(source);
    const entries = [...(this.#entriesByDependency.get(normalized) ?? [])].sort();
    return Object.freeze([normalized, ...entries.filter((entry) => entry !== normalized)]);
  }

  async #visit(
    entry: string,
    source: string,
    dependencies: Set<string>,
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
    let imports;
    try {
      [imports] = parse(text, source);
    } catch {
      // Import analysis is an HMR optimization. Module loading remains the
      // authority for syntax diagnostics and must not be hidden by the index.
      return;
    }
    for (const imported of imports) {
      if (!imported.n) continue;
      const dependency = await resolveLocalImport(source, imported.n);
      if (dependency) await this.#visit(entry, dependency, dependencies, visited);
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
      const resolvedImport = createRequire(pathToFileURL(importer)).resolve(specifier);
      if (resolvedImport.startsWith('node:')) return undefined;
      requested = resolvedImport;
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

async function exists(source: string): Promise<boolean> {
  try {
    await access(source);
    return true;
  } catch {
    return false;
  }
}
