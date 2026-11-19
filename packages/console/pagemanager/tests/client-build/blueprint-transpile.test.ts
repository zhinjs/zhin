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
import { afterEach, describe, expect, it } from 'vitest';
import ts from 'typescript';
import * as consoleContract from '@zhin.js/console-contract';
import {
  resolveBlueprintRelativeImport,
  transpileBlueprintGraph,
} from '../../src/client-build/blueprint-transpile.js';

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
});
