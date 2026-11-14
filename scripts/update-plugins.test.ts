import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GENERIC_PLUGIN_KEYWORDS as TS_GENERIC_KEYWORDS,
  PLUGIN_CATEGORIES as TS_CATEGORIES,
} from '../packages/im/plugin-runtime/src/marketplace-metadata.js';
import { GENERIC_PLUGIN_KEYWORDS, PLUGIN_CATEGORIES, packageAuthorName } from './lib/plugin-marketplace.mjs';
import {
  collectWorkspacePlugins,
  getCommunityCategory,
  officialRegistryEntry,
  registryStats,
} from './update-plugins.mjs';

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
    expect(found.get('@zhin.js/plugin-echo')?.category).toBe('utility');
  });

  it('prefers the declared zhin.metadata.category over the workspace directory', () => {
    const root = fixture({
      'utils/guard': { name: '@zhin.js/plugin-guard', zhin: { type: 'plugin', metadata: { category: 'moderation' } } },
      'utils/odd': { name: '@zhin.js/plugin-odd', zhin: { type: 'plugin', metadata: { category: 'not-a-category' } } },
    });
    const found = collectWorkspacePlugins(root);
    expect(found.get('@zhin.js/plugin-guard')?.category).toBe('moderation');
    expect(found.get('@zhin.js/plugin-odd')?.category).toBe('utility');
  });

  it('builds official entries from the manifest: localized texts, maintainer author, informative tags', () => {
    const entry = officialRegistryEntry('@zhin.js/plugin-rss', {
      category: 'information',
      dir: 'plugins/utils/rss',
      manifest: {
        name: '@zhin.js/plugin-rss',
        description: 'Feeds',
        keywords: ['zhin', 'zhin.js', 'bot', 'rss', 'atom'],
        author: { name: 'lc-cn', url: 'https://github.com/zhinjs/zhin' },
        zhin: {
          type: 'plugin',
          metadata: {
            displayName: 'RSS',
            displayNameI18n: { 'zh-CN': 'RSS 订阅', en: 'RSS Feeds' },
            descriptionI18n: { 'zh-CN': '订阅推送', en: 'Feeds' },
            category: 'information',
          },
        },
      },
    });
    expect(entry).toMatchObject({
      displayName: 'RSS',
      displayNameI18n: { 'zh-CN': 'RSS 订阅', en: 'RSS Feeds' },
      descriptionI18n: { 'zh-CN': '订阅推送', en: 'Feeds' },
      author: 'lc-cn',
      category: 'information',
      tags: ['rss', 'atom'],
    });
  });

  it('infers community categories from keywords within the closed list', () => {
    expect(getCommunityCategory('zhin.js-adapter-x')).toBe('adapter');
    expect(getCommunityCategory('zhin.js-x', ['moderation'])).toBe('moderation');
    expect(getCommunityCategory('zhin.js-x', ['games'])).toBe('game');
    expect(getCommunityCategory('zhin.js-x', ['util'])).toBe('utility');
    expect(registryStats([{ isOfficial: true, category: 'game' }]).categories).toMatchObject({ game: 1, utility: 0 });
  });

  it('keeps the script lists equal to @zhin.js/plugin-runtime', () => {
    expect([...PLUGIN_CATEGORIES]).toEqual([...TS_CATEGORIES]);
    expect([...GENERIC_PLUGIN_KEYWORDS]).toEqual([...TS_GENERIC_KEYWORDS]);
  });

  it('docs/public/plugins.json lists no official package outside the workspace plugins', () => {
    const workspace = collectWorkspacePlugins();
    const registry = JSON.parse(readFileSync(path.join(repoRoot, 'docs/public/plugins.json'), 'utf8')) as {
      plugins: { name: string; isOfficial: boolean; category: string; author: string }[];
    };
    const strays = registry.plugins
      .filter((plugin) => plugin.isOfficial && !workspace.has(plugin.name))
      .map((plugin) => plugin.name);
    expect(strays).toEqual([]);
    for (const plugin of registry.plugins.filter((entry) => entry.isOfficial)) {
      expect(plugin.category, plugin.name).toBe(workspace.get(plugin.name)?.category);
      // The market shows the maintainer, never the CI publishing account.
      expect(plugin.author, plugin.name).not.toMatch(/github actions/iu);
    }
  });
});

describe('packageAuthorName (script copy)', () => {
  it('keeps only the name before the first < or (', () => {
    expect(packageAuthorName({ author: 'Jane Doe <jane@example.com> (https://example.com)' })).toBe('Jane Doe');
    expect(packageAuthorName({ author: 'Jane (JD)' })).toBe('Jane');
    expect(packageAuthorName({ author: 'x<<script>script>' })).toBe('x');
    expect(packageAuthorName({ author: '<a@b.c>' })).toBeUndefined();
  });
});
