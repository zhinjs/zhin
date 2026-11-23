import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * #1250 `instance-still-loads-cli-bits`: the supervised instance keeps every module its startup
 * entry imports statically. CLI-only packages must stay out of that graph; they load through a
 * dynamic `import()` when a command, wizard step or Console action needs them.
 */
const FORBIDDEN_PACKAGES = [
  '@zhin.js/scaffold-wizard', '@zhin.js/cli', 'puppeteer-core', 'inquirer', 'typescript',
  // Import analysis for hot reload loads with the first reload, not at startup (`prod-runs-dependency-index`).
  'es-module-lexer',
];

const instanceEntry = resolve(import.meta.dirname, '../../src/instance/index.ts');
const repositoryRoot = resolve(import.meta.dirname, '../../../../..');
/**
 * The supervised instance child is `zhin runtime start` re-spawned by the gateway: `cli.ts` takes the
 * launcher path (`runtime-instance.ts`) and reaches the command tree (`program.ts`, which may load
 * the scaffold wizard) only through a dynamic `import()`. Both CLI files are walked statically too.
 */
const instanceChildEntries = [
  resolve(repositoryRoot, 'basic/cli/src/cli.ts'),
  resolve(repositoryRoot, 'basic/cli/src/commands/runtime-instance.ts'),
];
const sourceExtensions = ['.ts', '.tsx', '.mts', '.js', '.mjs'];

interface Graph {
  readonly files: ReadonlySet<string>;
  /** Bare package specifier → first workspace file importing it statically. */
  readonly packages: ReadonlyMap<string, string>;
  readonly parents: ReadonlyMap<string, string>;
}

/**
 * Static import graph of the workspace sources (development condition), as emitted: each file is
 * transpiled first, so imports TypeScript elides (types only) do not count. Packages installed
 * from the registry are recorded by name and not entered.
 */
function staticGraph(entry: string): Graph {
  const files = new Set<string>([entry]);
  const packages = new Map<string, string>();
  const parents = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const specifier of staticSpecifiers(file)) {
      if (specifier.startsWith('node:')) continue;
      let target: string | undefined;
      if (specifier.startsWith('.')) {
        target = resolveRelative(file, specifier);
      } else {
        const name = packageName(specifier);
        if (!packages.has(name)) packages.set(name, file);
        target = resolveWorkspacePackage(file, specifier);
      }
      if (target && !files.has(target)) {
        files.add(target);
        parents.set(target, file);
        queue.push(target);
      }
    }
  }
  return { files, packages, parents };
}

function staticSpecifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  if (file.endsWith('.json')) return [];
  const output = /\.(?:m?ts|tsx)$/u.test(file)
    ? ts.transpileModule(source, {
        fileName: file,
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          jsxImportSource: 'zhin.js',
          verbatimModuleSyntax: false,
          experimentalDecorators: true,
        },
      }).outputText
    : source;
  const parsed = ts.createSourceFile(file, output, ts.ScriptTarget.ES2022, false, ts.ScriptKind.JS);
  const specifiers: string[] = [];
  for (const statement of parsed.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
      && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

function resolveRelative(importer: string, specifier: string): string | undefined {
  const requested = resolve(dirname(importer), specifier);
  const stem = requested.replace(/\.(?:m?js|jsx)$/u, '');
  for (const candidate of [requested, ...sourceExtensions.map((extension) => `${stem}${extension}`),
    ...sourceExtensions.map((extension) => join(requested, `index${extension}`))]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return realpathSync(candidate);
  }
  return undefined;
}

function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/** Workspace packages only (realpath outside `node_modules`), through `development` / `import` exports. */
function resolveWorkspacePackage(importer: string, specifier: string): string | undefined {
  const name = packageName(specifier);
  let directory = dirname(importer);
  for (;;) {
    const candidate = join(directory, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) {
      const root = realpathSync(candidate);
      if (root.split(sep).includes('node_modules')) return undefined;
      const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { exports?: unknown };
      const subpath = `.${specifier.slice(name.length)}`;
      const target = exportTarget(manifest.exports, subpath);
      return target ? realpathSync(join(root, target)) : undefined;
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function exportTarget(exports: unknown, subpath: string): string | undefined {
  if (!exports || typeof exports !== 'object') return subpath === '.' && typeof exports === 'string' ? exports : undefined;
  const entry = (exports as Record<string, unknown>)[subpath];
  return pickCondition(entry);
}

function pickCondition(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return undefined;
  const conditions = entry as Record<string, unknown>;
  for (const condition of ['development', 'import', 'node', 'default']) {
    if (condition in conditions) return pickCondition(conditions[condition]);
  }
  return undefined;
}

function chain(graph: Graph, file: string): string[] {
  const steps = [file];
  while (graph.parents.has(steps[0]!)) steps.unshift(graph.parents.get(steps[0]!)!);
  return steps;
}

describe('zhin.js/instance static import graph', () => {
  it('keeps CLI-only packages out of what the instance loads at startup', () => {
    const graph = staticGraph(instanceEntry);
    // Sanity: the walk follows workspace packages (gateway, runtime, core) through their sources.
    expect(graph.files.size).toBeGreaterThan(200);
    expect([...graph.files].some((file) => file.includes(`${sep}packages${sep}host${sep}gateway${sep}src${sep}`))).toBe(true);
    const found = FORBIDDEN_PACKAGES.flatMap((name) => {
      const importer = graph.packages.get(name);
      return importer ? [`${name} via ${chain(graph, importer).join(' -> ')}`] : [];
    });
    expect(found).toEqual([]);
  }, 60_000);

  it.each(instanceChildEntries)('keeps CLI-only packages out of the instance child launcher %s', (entry) => {
    expect(existsSync(entry)).toBe(true);
    const graph = staticGraph(entry);
    const found = FORBIDDEN_PACKAGES.flatMap((name) => {
      const importer = graph.packages.get(name);
      return importer ? [`${name} via ${chain(graph, importer).join(' -> ')}`] : [];
    });
    expect(found).toEqual([]);
    // The launcher never pulls in the command tree statically.
    expect([...graph.files].some((file) => file.endsWith(`${sep}basic${sep}cli${sep}src${sep}program.ts`))).toBe(false);
  }, 60_000);

  it('sees the scaffold wizard in the CLI command tree, which legitimately imports it', () => {
    // The CLI is the scaffolding tool: `program.ts` may depend on the wizard statically. This keeps
    // the launcher assertions above meaningful (the walk does find the wizard where it is imported).
    const graph = staticGraph(resolve(repositoryRoot, 'basic/cli/src/program.ts'));
    expect(graph.packages.has('@zhin.js/scaffold-wizard')).toBe(true);
  }, 60_000);
});
