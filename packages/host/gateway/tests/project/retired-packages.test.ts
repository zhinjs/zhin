import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RETIRED_ZHIN_PACKAGES,
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

describe('retired @zhin.js packages (#1250 retired-package-not-flagged)', () => {
  it('lists @zhin.js/config-yaml as merged into @zhin.js/runtime (YamlConfigDocument)', () => {
    const entry = findRetiredZhinPackage('@zhin.js/config-yaml');
    expect(entry).toMatchObject({ status: 'merged', replacement: '@zhin.js/runtime' });
    expect(entry!.imports).toEqual([{ from: '@zhin.js/config-yaml', to: '@zhin.js/runtime', symbols: ['YamlConfigDocument'] }]);
    expect(entry!.action).toContain("import { YamlConfigDocument } from '@zhin.js/runtime'");
    expect(entry!.action).toContain('删除 @zhin.js/config-yaml 依赖');
    expect(findRetiredZhinPackage('@zhin.js/runtime')).toBeUndefined();
  });

  it('names no package that still exists in the workspace, and every replacement and import target exists', async () => {
    const workspace = workspaceManifests();
    const names = RETIRED_ZHIN_PACKAGES.map(entry => entry.name);
    expect(names).toEqual([...names].sort());
    for (const entry of RETIRED_ZHIN_PACKAGES) {
      expect(workspace.has(entry.name), `${entry.name} is still a workspace package`).toBe(false);
      expect(entry.action, entry.name).toContain(`删除 ${entry.name}`);
      if (entry.status === 'merged') expect(entry.replacement, entry.name).toBeDefined();
      if (entry.replacement) expect(workspace.has(entry.replacement), `${entry.replacement} missing`).toBe(true);
      for (const rule of entry.imports) {
        const [scope, base, ...rest] = rule.to.split('/');
        const target = workspace.get(`${scope}/${base}`);
        expect(target, rule.to).toBeDefined();
        const subpath = rest.length ? `./${rest.join('/')}` : '.';
        expect(Object.keys(target!.manifest.exports ?? {}), rule.to).toContain(subpath);
      }
    }
    // The named symbols really are exported by the replacement.
    const runtime = await import('@zhin.js/runtime');
    expect(typeof runtime.YamlConfigDocument).toBe('function');
    expect(typeof runtime.JsonConfigDocument).toBe('function');
    expect(typeof runtime.createConfigDocument).toBe('function');
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

  it('locates imports of retired packages with their replacement, subpaths kept, comments ignored', () => {
    const source = [
      "// see '@zhin.js/config-yaml' docs",
      "import { YamlConfigDocument } from '@zhin.js/config-yaml';",
      "export { x } from \"@zhin.js/isolate/transport\";",
      "const lazy = await import('@zhin.js/workroom');",
      "import '@zhin.js/runtime';",
    ].join('\n');
    expect(findRetiredImports(source).map(use => [use.line, use.specifier, use.replacement])).toEqual([
      [2, '@zhin.js/config-yaml', '@zhin.js/runtime'],
      [3, '@zhin.js/isolate/transport', '@zhin.js/runtime/isolate/transport'],
      [4, '@zhin.js/workroom', undefined],
    ]);
  });
});
