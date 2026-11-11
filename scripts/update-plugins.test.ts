import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { collectWorkspacePlugins } from './update-plugins.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoots: string[] = [];

function fixture(packages: Record<string, Record<string, unknown>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'zhin-update-plugins-'));
  tempRoots.push(root);
  for (const [dir, manifest] of Object.entries(packages)) {
    mkdirSync(path.join(root, dir), { recursive: true });
    writeFileSync(path.join(root, dir, 'package.json'), JSON.stringify(manifest));
  }
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('update-plugins workspace filter', () => {
  it('lists only public packages whose zhin.type is plugin or adapter', () => {
    const root = fixture({
      'adapters/demo': { name: '@zhin.js/adapter-demo', zhin: { type: 'adapter' } },
      'utils/echo': { name: '@zhin.js/plugin-echo', zhin: { type: 'plugin' } },
      'games/dice': { name: '@zhin.js/plugin-dice', zhin: { type: 'plugin' } },
      'utils/feature': { name: '@zhin.js/some-feature', zhin: { type: 'feature' } },
      'utils/library': { name: '@zhin.js/library' },
      'utils/private': { name: '@zhin.js/plugin-private', private: true, zhin: { type: 'plugin' } },
      'unknown-group/x': { name: '@zhin.js/plugin-x', zhin: { type: 'plugin' } },
    });
    const found = collectWorkspacePlugins(root);
    expect([...found.keys()].sort()).toEqual([
      '@zhin.js/adapter-demo',
      '@zhin.js/plugin-dice',
      '@zhin.js/plugin-echo',
    ]);
    expect(found.get('@zhin.js/adapter-demo')).toMatchObject({ category: 'adapter', dir: 'plugins/adapters/demo' });
    expect(found.get('@zhin.js/plugin-dice')?.category).toBe('game');
    expect(found.get('@zhin.js/plugin-echo')?.category).toBe('util');
  });

  it('docs/public/plugins.json lists no official package outside the workspace plugins', () => {
    const workspace = collectWorkspacePlugins();
    const registry = JSON.parse(readFileSync(path.join(repoRoot, 'docs/public/plugins.json'), 'utf8')) as {
      plugins: { name: string; isOfficial: boolean; category: string }[];
    };
    const strays = registry.plugins
      .filter((plugin) => plugin.isOfficial && !workspace.has(plugin.name))
      .map((plugin) => plugin.name);
    expect(strays).toEqual([]);
    for (const plugin of registry.plugins.filter((entry) => entry.isOfficial)) {
      expect(plugin.category, plugin.name).toBe(workspace.get(plugin.name)?.category);
    }
  });
});
