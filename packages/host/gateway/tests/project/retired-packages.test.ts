import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REMOVED_ZHIN_SUBPATHS,
  RETIRED_PACKAGES_DOCS_URL,
  RETIRED_ZHIN_PACKAGES,
  findRemovedZhinSubpath,
  findRetiredDependencies,
  findRetiredImports,
  findRetiredZhinPackage,
} from '../../src/project/retired-packages.js';

const repo = path.resolve(import.meta.dirname, '../../../../..');

/** Every workspace package.json by package name. */
function workspaceManifests(): Map<string, { dir: string; manifest: Record<string, any> }> {
  const found = new Map<string, { dir: string; manifest: Record<string, any> }>();
  const walk = (dir: string, depth: number): void => {
    if (depth > 4) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const child = path.join(dir, entry.name);
      const file = path.join(child, 'package.json');
      if (fs.existsSync(file)) {
        const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (typeof manifest.name === 'string') found.set(manifest.name, { dir: child, manifest });
      }
      walk(child, depth + 1);
    }
  };
  for (const top of ['basic', 'packages', 'plugins']) walk(path.join(repo, top), 1);
  return found;
}

/**
 * Every `@zhin.js/*` package the registry lists that no workspace package carries any more
 * (registry listing of 2026-11, #1250 review). `@zhin.js/agent-media` is left out: it is an
 * external dependency of `@zhin.js/agent`, still current.
 */
const FORMER_REGISTRY_PACKAGES = [
  '@zhin.js/adapter-process', '@zhin.js/ai-provider', '@zhin.js/config-file', '@zhin.js/config-yaml',
  '@zhin.js/console', '@zhin.js/console-app', '@zhin.js/console-core', '@zhin.js/console-types',
  '@zhin.js/dependency', '@zhin.js/devteam', '@zhin.js/game-shared', '@zhin.js/hmr', '@zhin.js/host-api',
  '@zhin.js/host-router', '@zhin.js/http', '@zhin.js/http-host', '@zhin.js/interaction', '@zhin.js/isolate',
  '@zhin.js/plugin-github-notify', '@zhin.js/plugin-html-renderer', '@zhin.js/plugin-test-kit',
  '@zhin.js/plugin-voice', '@zhin.js/queue-runtime', '@zhin.js/satori', '@zhin.js/sensitive-filter',
  '@zhin.js/storage-port', '@zhin.js/types', '@zhin.js/workroom',
];

describe('retired @zhin.js packages (#1250 retired-package-not-flagged)', () => {
  it('lists @zhin.js/config-yaml as merged into @zhin.js/runtime, with the renamed error base class', async () => {
    const entry = findRetiredZhinPackage('@zhin.js/config-yaml');
    expect(entry).toMatchObject({ status: 'merged', replacement: '@zhin.js/runtime' });
    expect(entry!.imports).toEqual([{
      from: '@zhin.js/config-yaml',
      to: '@zhin.js/runtime',
      symbols: ['YamlConfigDocument', 'ConfigDocumentParseError', 'ConfigDocumentConflictError'],
      renamed: { YamlConfigDocumentError: 'ConfigFileDocumentError' },
    }]);
    expect(entry!.action).toContain("import { YamlConfigDocument } from '@zhin.js/runtime'");
    expect(entry!.action).toContain('YamlConfigDocumentError 改名为 ConfigFileDocumentError');
    expect(entry!.action).toContain('ConfigDocumentParseError、ConfigDocumentConflictError 改为继承 ConfigFileDocumentError');
    expect(entry!.action).toContain('删除 @zhin.js/config-yaml 依赖');
    expect(findRetiredZhinPackage('@zhin.js/runtime')).toBeUndefined();
    // What the entry says is what @zhin.js/runtime exports.
    const runtime = await import('@zhin.js/runtime');
    expect(new runtime.ConfigDocumentParseError('f', 'yaml', [])).toBeInstanceOf(runtime.ConfigFileDocumentError);
    expect(new runtime.ConfigDocumentConflictError('f')).toBeInstanceOf(runtime.ConfigFileDocumentError);
    expect('YamlConfigDocumentError' in runtime).toBe(false);
  });

  it('has no @zhin.js/tools entry (that package never existed); the deleted subpath @zhin.js/agent/tools points to @zhin.js/tool', () => {
    expect(findRetiredZhinPackage('@zhin.js/tools')).toBeUndefined();
    expect(REMOVED_ZHIN_SUBPATHS.map(entry => entry.specifier)).toEqual(['@zhin.js/agent/tools']);
    const removed = findRemovedZhinSubpath('@zhin.js/agent/tools');
    expect(removed).toMatchObject({ package: '@zhin.js/agent', replacement: '@zhin.js/tool', symbols: ['defineAgentTool'] });
    expect(removed!.action).toContain('defineAgentTool 改从 @zhin.js/tool 导入');
    expect(findRemovedZhinSubpath('@zhin.js/agent/tools/x')).toBe(removed);
    expect(findRemovedZhinSubpath('@zhin.js/agent/toolsx')).toBeUndefined();
    expect(findRemovedZhinSubpath('@zhin.js/agent')).toBeUndefined();
    expect(findRemovedZhinSubpath('@zhin.js/agent/tool')).toBeUndefined();
  });

  it('covers every former @zhin.js package of the registry; one without a successor says so and points to the docs', () => {
    const names = new Set(RETIRED_ZHIN_PACKAGES.map(entry => entry.name));
    expect(FORMER_REGISTRY_PACKAGES.filter(name => !names.has(name))).toEqual([]);
    expect(findRetiredZhinPackage('@zhin.js/agent-media')).toBeUndefined();
    for (const name of ['@zhin.js/dependency', '@zhin.js/devteam', '@zhin.js/hmr', '@zhin.js/queue-runtime', '@zhin.js/storage-port', '@zhin.js/types']) {
      const entry = findRetiredZhinPackage(name)!;
      expect(entry, name).toMatchObject({ status: 'removed', imports: [] });
      expect(entry.replacement, name).toBeUndefined();
      expect(entry.action, name).toBe(`已停更，无直接替代（参见迁移文档 ${RETIRED_PACKAGES_DOCS_URL}）：确认项目不再使用它后删除 ${name} 依赖`);
    }
    expect(findRetiredZhinPackage('@zhin.js/plugin-test-kit')).toMatchObject({
      status: 'renamed', replacement: '@zhin.js/testing',
      imports: [{ from: '@zhin.js/plugin-test-kit', to: '@zhin.js/testing', symbols: [] }],
    });
  });

  it('names no package that still exists in the workspace, and every replacement and import target exists', () => {
    const workspace = workspaceManifests();
    const names = RETIRED_ZHIN_PACKAGES.map(entry => entry.name);
    expect(names).toEqual([...names].sort());
    for (const entry of RETIRED_ZHIN_PACKAGES) {
      expect(workspace.has(entry.name), `${entry.name} is still a workspace package`).toBe(false);
      expect(entry.action, entry.name).toContain(`删除 ${entry.name}`);
      if (entry.status !== 'removed') expect(entry.replacement, entry.name).toBeDefined();
      if (entry.replacement) expect(workspace.has(entry.replacement), `${entry.replacement} missing`).toBe(true);
      for (const rule of entry.imports) {
        const [scope, base, ...rest] = rule.to.split('/');
        const target = workspace.get(`${scope}/${base}`);
        expect(target, rule.to).toBeDefined();
        const subpath = rest.length ? `./${rest.join('/')}` : '.';
        expect(Object.keys(target!.manifest.exports ?? {}), rule.to).toContain(subpath);
      }
    }
    for (const entry of REMOVED_ZHIN_SUBPATHS) {
      const owner = workspace.get(entry.package);
      expect(owner, entry.package).toBeDefined();
      expect(Object.keys(owner!.manifest.exports ?? {})).not.toContain(`./${entry.specifier.slice(entry.package.length + 1)}`);
      const target = workspace.get(entry.replacement);
      expect(target, entry.replacement).toBeDefined();
      const sources = fs.readFileSync(path.join(target!.dir, 'src', 'definition.ts'), 'utf8');
      for (const symbol of entry.symbols) expect(sources).toContain(`export function ${symbol}`);
    }
  });

  it('finds retired direct dependencies in every dependency field', () => {
    const hits = findRetiredDependencies({
      dependencies: { 'zhin.js': '^1.0.0', '@zhin.js/config-yaml': '^1.1.0' },
      devDependencies: { '@zhin.js/isolate': '1.0.0' },
      peerDependencies: { '@zhin.js/runtime': '*' },
    });
    expect(hits.map(hit => [hit.name, hit.field, hit.specifier])).toEqual([
      ['@zhin.js/config-yaml', 'dependencies', '^1.1.0'],
      ['@zhin.js/isolate', 'devDependencies', '1.0.0'],
    ]);
    expect(findRetiredDependencies(undefined)).toEqual([]);
    expect(findRetiredDependencies({ dependencies: [] })).toEqual([]);
  });

  it('locates imports of retired packages with their replacement; a subpath of a package that exported only . gets none', () => {
    const source = [
      "// see '@zhin.js/config-yaml' docs",
      "import { YamlConfigDocument } from '@zhin.js/config-yaml';",
      "export { x } from \"@zhin.js/isolate/transport\";",
      "const lazy = await import('@zhin.js/workroom');",
      "import '@zhin.js/runtime';",
    ].join('\n');
    const uses = findRetiredImports(source);
    expect(uses.map(use => [use.line, use.specifier, use.replacement])).toEqual([
      [2, '@zhin.js/config-yaml', '@zhin.js/runtime'],
      // @zhin.js/isolate exported only `.`: `@zhin.js/runtime/isolate/transport` does not exist.
      [3, '@zhin.js/isolate/transport', undefined],
      [4, '@zhin.js/workroom', undefined],
    ]);
    expect(uses[1]!.action).toBe(findRetiredZhinPackage('@zhin.js/isolate')!.action);
  });

  it('ignores specifiers in line and block comments and inside other strings', () => {
    const source = [
      "// copied from '@zhin.js/config-yaml'",
      "/* import '@zhin.js/isolate'",
      "   from '@zhin.js/workroom' */",
      "const msg = \"install from '@zhin.js/workroom'\";",
      "const url = 'https://x//y'; import a from '@zhin.js/isolate';",
      "vi.mock('@zhin.js/isolate'); require.resolve('@zhin.js/isolate'); obj.import('@zhin.js/isolate');",
      "const t = `from '@zhin.js/isolate'`;",
      "import {",
      "  a,",
      "} from /* why */",
      "  '@zhin.js/interaction';",
      "const m = require ( '@zhin.js/config-file' );",
      "import x = require('@zhin.js/isolate');",
      "export * from '@zhin.js/interaction';",
      "import type { X } from '@zhin.js/ai-provider';",
      "const lazy = import(`@zhin.js/isolate`);",
      "const dyn = import(`@zhin.js/${name}`);",
      "import { defineAgentTool } from '@zhin.js/agent/tools';",
    ].join('\n');
    expect(findRetiredImports(source).map(use => [use.line, use.specifier])).toEqual([
      [5, '@zhin.js/isolate'],
      [11, '@zhin.js/interaction'],
      [12, '@zhin.js/config-file'],
      [13, '@zhin.js/isolate'],
      [14, '@zhin.js/interaction'],
      [15, '@zhin.js/ai-provider'],
      [16, '@zhin.js/isolate'],
      [18, '@zhin.js/agent/tools'],
    ]);
  });

  it('reports the deleted subpath @zhin.js/agent/tools with @zhin.js/tool, a deeper path without a replacement', () => {
    const uses = findRetiredImports("import { defineAgentTool } from '@zhin.js/agent/tools';\nimport x from '@zhin.js/agent/tools/x';\nimport y from '@zhin.js/agent';\n");
    expect(uses.map(use => [use.line, use.specifier, use.replacement, use.removedSubpath?.specifier, use.retired])).toEqual([
      [1, '@zhin.js/agent/tools', '@zhin.js/tool', '@zhin.js/agent/tools', undefined],
      [2, '@zhin.js/agent/tools/x', undefined, '@zhin.js/agent/tools', undefined],
    ]);
    expect(uses[0]!.action).toContain('子路径 @zhin.js/agent/tools 已删除');
  });

  it('counts lines across comments, templates and escaped newlines', () => {
    const source = "/* a\nb */ const t = `x\ny`; const s = 'a\\\nb';\nimport a from '@zhin.js/isolate';\n";
    expect(findRetiredImports(source).map(use => use.line)).toEqual([5]);
  });

  it('stays linear on large and adversarial inputs', () => {
    const inputs = [
      'import' + ' '.repeat(200_000) + 'x',
      'from '.repeat(100_000),
      'import( '.repeat(100_000),
      '/*'.repeat(100_000),
      "'".repeat(200_000),
      'a.'.repeat(100_000) + ' '.repeat(100_000),
      "import a from '@zhin.js/isolate';\n".repeat(20_000),
    ];
    const started = performance.now();
    const counts = inputs.map(input => findRetiredImports(input).length);
    expect(counts).toEqual([0, 0, 0, 0, 0, 0, 20_000]);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(findRetiredImports("import a from '@zhin.js/isolate';\n".repeat(20_000)).at(-1)!.line).toBe(20_000);
  });
});
