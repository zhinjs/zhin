/**
 * #1250: pure Blueprint pages are transpiled with esbuild `transform` instead of
 * `ts.transpileModule`. These tests evaluate every pure Blueprint page in the repository (and
 * synthetic edge cases) through both transpilers and require identical results.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import * as consoleContract from '@zhin.js/console-contract';
import {
  resolveBlueprintRelativeImport,
  transpileBlueprintGraph,
} from '../../src/client-build/blueprint-transpile.js';
import { TypeScriptClientBuilder } from '../../src/client-build/index.js';

/** Counts esbuild `transform` calls still running (the builder's esbuild service window). */
const esbuildCalls = vi.hoisted(() => ({ inFlight: 0, started: [] as string[] }));
vi.mock('esbuild', async (importOriginal) => {
  const original = await importOriginal<typeof import('esbuild')>();
  return {
    ...original,
    transform: async (...args: Parameters<typeof original.transform>) => {
      esbuildCalls.inFlight += 1;
      esbuildCalls.started.push(String(args[1]?.sourcefile));
      try {
        return await original.transform(...args);
      } finally {
        esbuildCalls.inFlight -= 1;
      }
    },
  };
});

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const PURE_BLUEPRINT_CALL_RE =
  /\b(?:definePageBlueprint|createDeclarativePage|defineAdapterPage|createAdapterConsolePage|defineCommentReviewPage|createCommentReviewPage)\s*\(/u;
const FORBIDDEN_BROWSER_IMPORT_RE =
  /from\s+['"](?:react|react-dom|@zhin\.js\/client)(?:\/[^'"]*)?['"]/u;
const CONTRACT_SPECIFIERS = new Set(['@zhin.js/console-contract', '@zhin.js/page', 'zhin.js/page']);

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** Same module evaluation the builder performs, over precomputed CommonJS per file. */
function evaluate(entry: string, codeFor: (file: string) => string): Record<string, unknown> {
  const cache = new Map<string, Record<string, unknown>>();
  const run = (file: string): Record<string, unknown> => {
    const cached = cache.get(file);
    if (cached) return cached;
    const exportsObj: Record<string, unknown> = {};
    cache.set(file, exportsObj);
    const localRequire = (specifier: string): unknown => {
      if (CONTRACT_SPECIFIERS.has(specifier)) return consoleContract;
      const target = resolveBlueprintRelativeImport(file, specifier);
      if (!target) throw new Error(`Unsupported import: ${specifier}`);
      return run(target);
    };
    new Function('exports', 'require', codeFor(file))(exportsObj, localRequire);
    return exportsObj;
  };
  return run(resolve(entry));
}

function viaTypeScript(entry: string): Record<string, unknown> {
  return evaluate(entry, (file) => ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText);
}

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-blueprint-transpile-'));
  temporary.push(root);
  return root;
}

async function viaEsbuild(entry: string): Promise<Record<string, unknown>> {
  const graph = await transpileBlueprintGraph(
    entry,
    readFileSync(entry, 'utf8'),
    (text) => !FORBIDDEN_BROWSER_IMPORT_RE.test(text),
  );
  return evaluate(entry, (file) => {
    const code = graph.get(file)?.code;
    if (code === undefined) throw new Error(`not transpiled: ${file}`);
    return code;
  });
}

function blueprintOf(exportsObj: Record<string, unknown>): unknown {
  const value = exportsObj.default;
  const raw = typeof value === 'function' ? (value as () => unknown)() : value;
  return JSON.parse(JSON.stringify(raw));
}

function snapshot(exportsObj: Record<string, unknown>): unknown {
  return {
    keys: Object.keys(exportsObj).sort(),
    meta: JSON.parse(JSON.stringify(exportsObj.meta ?? null)),
    blueprint: blueprintOf(exportsObj),
  };
}

function pureBlueprintPages(): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 6) return;
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'lib' || name === 'dist' || name.startsWith('.')) continue;
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path, depth + 1);
      else if (/\/pages\/.+\.ts$/u.test(path)) {
        const text = readFileSync(path, 'utf8');
        if (PURE_BLUEPRINT_CALL_RE.test(text) && !FORBIDDEN_BROWSER_IMPORT_RE.test(text)) found.push(path);
      }
    }
  };
  for (const top of ['plugins', 'examples']) walk(join(repoRoot, top), 0);
  return found.sort();
}

describe('pure Blueprint transpilation (esbuild vs ts.transpileModule)', () => {
  const pages = pureBlueprintPages();

  it('finds the repository pure Blueprint pages', () => {
    expect(pages.length).toBeGreaterThan(10);
  });

  it.each(pages.map((page) => [page.slice(repoRoot.length + 1), page]))(
    'evaluates %s identically',
    async (_label, page) => {
      expect(snapshot(await viaEsbuild(page))).toEqual(snapshot(viaTypeScript(page)));
    },
  );

  it('handles relative imports, cycles, type-only imports, enums and class fields identically', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-blueprint-transpile-'));
    temporary.push(root);
    const files: Record<string, string> = {
      'pages/index/index.ts': [
        "import { definePage, definePageBlueprint } from '@zhin.js/console-contract';",
        "import type { ConsolePageBlueprint } from '@zhin.js/console-contract';",
        "import { sections, Kind } from './sections.js';",
        "import * as labels from './labels';",
        "import columnsDefault from './columns/index.js';",
        "export const meta = definePage({ title: 'Edge' });",
        'class Holder { value = labels.title; static count = 2; }',
        'const holder: Holder = new Holder();',
        'const spec = { title: `${holder.value}-${Kind.Status}-${Holder.count}`, sections, columns: columnsDefault } as unknown as ConsolePageBlueprint;',
        'export default definePageBlueprint(spec);',
      ].join('\n'),
      'pages/index/sections.ts': [
        "import { title } from './labels.js';",
        'export enum Kind { Status = 3, Other }',
        'export const sections = [{ id: `s-${title}`, kind: Kind.Other }];',
      ].join('\n'),
      'pages/index/labels.ts': [
        "import { sections } from './sections.js';",
        "export const title = 'Edge title';",
        'export function count(): number { return sections.length; }',
      ].join('\n'),
      'pages/index/columns/index.ts': "export default [{ key: 'id', label: 'ID' }] satisfies { key: string; label: string }[];",
    };
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    const entry = join(root, 'pages/index/index.ts');
    const expected = snapshot(viaTypeScript(entry));
    expect(snapshot(await viaEsbuild(entry))).toEqual(expected);
    expect(expected).toMatchObject({ blueprint: { title: 'Edge title-3-2' } });
  });

  it('leaves modules that import browser packages untranspiled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-blueprint-transpile-'));
    temporary.push(root);
    await writeFile(join(root, 'dep.ts'), "import { useState } from 'react';\nexport const x = useState;");
    const entry = join(root, 'page.ts');
    const text = "import { x } from './dep.js';\nexport default x;";
    await writeFile(entry, text);
    const graph = await transpileBlueprintGraph(entry, text, (source) => !FORBIDDEN_BROWSER_IMPORT_RE.test(source));
    expect(graph.get(resolve(entry))?.code).toBeTypeOf('string');
    expect(graph.get(join(root, 'dep.ts'))?.code).toBeUndefined();
  });

  it('evaluates modules in strict mode', async () => {
    const root = await tempRoot();
    const entry = join(root, 'page.ts');
    await writeFile(entry, 'export function leak() { (undeclaredBlueprintGlobal as unknown) = 1; }\nleak();\nexport default 1;');
    // ts.transpileModule emitted "use strict" too.
    expect(() => viaTypeScript(entry)).toThrow(ReferenceError);
    await expect(viaEsbuild(entry)).rejects.toThrow(ReferenceError);
    expect('undeclaredBlueprintGlobal' in globalThis).toBe(false);
  });

  it('rejects `export =` of a non-object instead of exporting nothing', async () => {
    const root = await tempRoot();
    await writeTree(root, {
      'number.ts': 'export = 1;',
      'function.ts': 'export = function blueprint() { return 1; };',
      'object.ts': 'export = { default: 2, extra: 3 };',
    });
    await expect(viaEsbuild(join(root, 'number.ts'))).rejects.toThrow(
      /Blueprint module \/.*number\.ts replaces module\.exports with a number value \(export =\)/u,
    );
    await expect(viaEsbuild(join(root, 'function.ts'))).rejects.toThrow(/replaces module\.exports with a function value/u);
    expect({ ...(await viaEsbuild(join(root, 'object.ts'))) }).toEqual({ default: 2, extra: 3 });
  });

  it('waits for every transform and reports the first failure without unhandled rejections', async () => {
    const root = await tempRoot();
    await writeTree(root, {
      'pages/index.ts': [
        "import { a } from './broken-a.js';",
        "import { b } from './broken-b.js';",
        "import { ok } from './ok.js';",
        'export default [a, b, ok];',
      ].join('\n'),
      'pages/broken-a.ts': 'export const a = ;',
      'pages/broken-b.ts': 'export const b = ;',
      // Discovered only once ok.ts has been transpiled, after the first failure.
      'pages/ok.ts': "import { late } from './late.js';\nexport const ok = late;",
      'pages/late.ts': 'export const late = ;',
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      esbuildCalls.started.length = 0;
      const entry = join(root, 'pages/index.ts');
      const error = await transpileBlueprintGraph(entry, readFileSync(entry, 'utf8'), () => true).then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(Error);
      expect(String((error as Error).message)).toMatch(/broken-[ab]\.ts/u);
      // Nothing is still running once the graph settled (the caller then closes the service).
      expect(esbuildCalls.inFlight).toBe(0);
      // Let any stray rejection surface.
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      expect(unhandled).toEqual([]);
      expect(esbuildCalls.inFlight).toBe(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('prefetches only generated require statements inside the plugin root', async () => {
    const root = await tempRoot();
    await writeTree(root, {
      'shared.ts': "export const shared = 'outside';",
      'plugin/package.json': '{ "name": "plugin" }',
      'plugin/pages/decoy.ts': 'export const decoy = ;',
      'plugin/pages/side.ts': 'export {};',
      'plugin/pages/reexported.ts': 'export const re = 1;',
      'plugin/pages/index.ts': [
        "import './side.js';",
        "export * from './reexported.js';",
        'const text = `require("./decoy.js")`;',
        "const call = 'x'.concat(String(typeof require !== 'undefined' && 'require(\"./decoy.js\")'));",
        'export default [text, call];',
      ].join('\n'),
      'plugin/pages/outside.ts': "import { shared } from '../../shared.js';\nexport default shared;",
    });
    const entry = join(root, 'plugin/pages/index.ts');
    const graph = await transpileBlueprintGraph(entry, readFileSync(entry, 'utf8'), () => true);
    expect([...graph.keys()].map((file) => file.slice(root.length + 1)).sort()).toEqual([
      'plugin/pages/index.ts',
      'plugin/pages/reexported.ts',
      'plugin/pages/side.ts',
    ]);

    // A relative import leaving the plugin root is not prefetched: evaluation reports it, and
    // the builder takes the bundle path.
    const outside = join(root, 'plugin/pages/outside.ts');
    const outsideGraph = await transpileBlueprintGraph(outside, readFileSync(outside, 'utf8'), () => true);
    expect(outsideGraph.has(join(root, 'shared.ts'))).toBe(false);
    await expect(viaEsbuild(outside)).rejects.toThrow(/not transpiled: .*shared\.ts/u);
  });

  it('throws on a circular import read before initialization (TDZ) and falls back to the bundle', async () => {
    const root = await tempRoot();
    await writeTree(root, {
      'pages/cycle/index.ts': [
        "import { definePage, definePageBlueprint } from '@zhin.js/console-contract';",
        "import { sections } from './sections.js';",
        "export const meta = definePage({ title: 'Cycle' });",
        "export default definePageBlueprint({ title: 'Cycle', sections } as never);",
      ].join('\n'),
      'pages/cycle/sections.ts': [
        "import { snapshot } from './labels.js';",
        "export const sections = [{ id: 'a', snapshot }];",
      ].join('\n'),
      // Reads `sections` while sections.ts is still evaluating its imports.
      'pages/cycle/labels.ts': "import { sections } from './sections.js';\nexport const snapshot = [sections];",
    });
    const entry = join(root, 'pages/cycle/index.ts');
    // Current behavior: ts.transpileModule read `undefined`; esbuild's live bindings hit the TDZ.
    expect(() => viaTypeScript(entry)).not.toThrow();
    await expect(viaEsbuild(entry)).rejects.toThrow(/before initialization/u);

    const builder = new TypeScriptClientBuilder({ projectRoot: root, outDir: join(root, 'dist/client') });
    const artifact = await builder.load<{ module: string; blueprint?: unknown }>(entry, {
      feature: 'zhin.page' as never,
      owner: 'root/cycle' as never,
      localName: 'cycle',
      source: entry,
    });
    expect(artifact.blueprint).toBeUndefined();
    const chunk = readFileSync(join(root, 'dist/client', artifact.module.split('/').at(-1)!), 'utf8');
    expect(chunk).not.toContain('unbundled synthesized module');
  });
});
