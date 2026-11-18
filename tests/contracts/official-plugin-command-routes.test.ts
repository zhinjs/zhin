/**
 * #1250 group-suite-rank-alias-collides-game-hub: with every official plugin enabled, no command
 * route (name, alias or shortcut) is claimed by two plugins. A conflict is not fatal at runtime —
 * the Command index keeps the earlier claim and logs `command_route_conflict` — but users then
 * silently get one plugin's command and lose the other's, so the official set must be free of them.
 *
 * All `plugins/** /package.json` packages with `zhin.type: "plugin"` are discovered with the real
 * Command feature provider and projected into one CommandIndex with default configuration (no
 * `commandNamespace`, no `disabledCommands`), the way a project that enables all of them sees it.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  childPluginId,
  rootPluginId,
  type PluginId,
  type PluginNodeSnapshot,
  type RuntimeSnapshot,
} from '../../packages/im/plugin-runtime/src/index.js';
import { FeatureDiscovery, type DirectoryEntry, type DiscoveryHost } from '../../packages/im/feature-kit/src/index.js';
import commandFeature from '../../packages/im/command/src/provider.js';
import { CommandIndex, type CommandRouteClaimant, type CommandRouteConflict } from '../../packages/im/command/src/command-index.js';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const pluginsRoot = path.join(repoRoot, 'plugins');

interface OfficialPlugin {
  readonly name: string;
  readonly packageName: string;
  readonly packageRoot: string;
}

/** The plugin's instance key: its `definePlugin({ name })`, or the unscoped package name without an entry. */
async function pluginName(packageRoot: string, packageName: string): Promise<string> {
  const entry = path.join(packageRoot, 'plugin.ts');
  const unscoped = packageName.replace(/^@[^/]+\//u, '');
  try {
    await readFile(entry);
  } catch {
    return unscoped;
  }
  const module = await import(pathToFileURL(entry).href) as { default?: { name?: unknown } };
  return typeof module.default?.name === 'string' ? module.default.name : unscoped;
}

async function findOfficialPlugins(directory: string, depth = 0): Promise<OfficialPlugin[]> {
  const found: OfficialPlugin[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some(entry => entry.isFile() && entry.name === 'package.json')) {
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')) as {
      name?: string; zhin?: { type?: string };
    };
    if (manifest.zhin?.type === 'plugin' && manifest.name) {
      return [{ name: await pluginName(directory, manifest.name), packageName: manifest.name, packageRoot: directory }];
    }
  }
  if (depth >= 3) return found;
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    if (['lib', 'dist', 'src', 'tests', 'commands'].includes(entry.name)) continue;
    found.push(...await findOfficialPlugins(path.join(directory, entry.name), depth + 1));
  }
  return found;
}

const host: DiscoveryHost = {
  async list(directory) {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      const result: DirectoryEntry[] = [];
      for (const entry of entries) {
        if (entry.isFile()) result.push({ name: entry.name, kind: 'file' });
        if (entry.isDirectory()) result.push({ name: entry.name, kind: 'directory' });
      }
      return result;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
      throw error;
    }
  },
  loadModule: async source => import(pathToFileURL(source).href),
  readText: source => readFile(source, 'utf8'),
};

function side(claimant: CommandRouteClaimant): string {
  const what = claimant.kind === 'command' ? claimant.command : `${claimant.command} ${claimant.kind}=${claimant.entry ?? ''}`;
  return `${claimant.plugin}:${what}`;
}

function describeConflict(conflict: CommandRouteConflict): string {
  return `「${conflict.route}」 ${side(conflict.skipped)} 被跳过（保留 ${side(conflict.kept)}）`;
}

async function officialCommandIndex(): Promise<{ plugins: readonly OfficialPlugin[]; index: CommandIndex }> {
  const plugins = await findOfficialPlugins(pluginsRoot);
  const root = rootPluginId();
  const ids = plugins.map(plugin => childPluginId(root, plugin.name));
  const tree = new Map<PluginId, PluginNodeSnapshot>([
    [root, { id: root, instanceKey: 'root', packageName: 'official-plugins', packageRoot: repoRoot, children: ids }],
    ...plugins.map((plugin, at) => [ids[at]!, {
      id: ids[at]!, instanceKey: plugin.name, packageName: plugin.packageName, packageRoot: plugin.packageRoot, parent: root, children: [],
    }] as const),
  ]);
  const slots = await new FeatureDiscovery(host).discover(
    commandFeature,
    plugins.map((plugin, at) => ({ owner: ids[at]!, packageRoot: plugin.packageRoot })),
  );
  const snapshot: RuntimeSnapshot = {
    generation: 1,
    root,
    tree,
    config: new Map([[root, {}], ...ids.map(id => [id, {}] as const)]),
    resources: new Map([[root, new Map()], ...ids.map(id => [id, new Map()] as const)]),
    capabilities: new Map(slots.map(slot => [slot.id, slot])),
    projections: new Map(),
  };
  return { plugins, index: new CommandIndex(slots, snapshot) };
}

describe('official plugins: command routes (#1250 group-suite-rank-alias-collides-game-hub)', () => {
  it('loads every official plugin into one Command index without a command_route_conflict', async () => {
    const { plugins, index } = await officialCommandIndex();
    expect(plugins.length).toBeGreaterThanOrEqual(50);
    expect(plugins.map(plugin => plugin.name)).toEqual(expect.arrayContaining(['group-suite', 'game-hub']));
    expect(index.list().length).toBeGreaterThanOrEqual(100);
    const conflicts = index.conflicts().map(describeConflict);
    expect(conflicts, `command_route_conflict:\n${conflicts.join('\n')}`).toEqual([]);
  }, 120_000);
});
