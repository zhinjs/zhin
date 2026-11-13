import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import type { PluginManagementState } from '@zhin.js/host-http';
import { createAttentionSources } from '../../../src/instance/console/attention-sources.js';
import { collectAttention } from '../../../src/instance/console/attention.js';
import type { ConsoleRpcComposition } from '../../../src/instance/console/rpc-composition.js';

const roots: string[] = [];
const stores: SnapshotStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function snapshots(): SnapshotStore {
  const root = rootPluginId();
  const state: SnapshotState = {
    root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: '/app', children: [] }]]),
    config: new Map(), capabilities: new Map(), projections: new Map(), resources: new Map([[root, new Map()]]),
  };
  const store = new SnapshotStore(state);
  stores.push(store);
  return store;
}

function management(overrides: Partial<PluginManagementState>): PluginManagementState {
  return {
    packageName: 'weather-pkg', instanceKey: 'weather', installed: true, plugin: true, declared: true, version: '1.0.0', revision: 'r',
    projectRevision: 'p', status: 'enabled', dependencies: 'passed', validation: { valid: true, errors: [], missingEnv: [] }, generation: 1,
    published: true, readiness: 'ready', restartRequired: false, disabled: false, issues: [], verification: 'not-configured', ...overrides,
  };
}

describe('attention sources wired to the instance', () => {
  it('inspects declared plugins, reads configured MCP servers and counts error logs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-attention-sources-'));
    roots.push(root);
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'root', dependencies: { 'weather-pkg': '*', 'news-pkg': '*' }, zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify({
      configVersion: 2, plugins: { weather: 'weather-pkg', news: 'news-pkg' },
      ai: { mcpServers: [{ name: 'search', transport: 'stdio' }] },
    }));
    const inspected: string[] = [];
    const rows = [{ timestamp: new Date('2026-11-13T07:00:00.000Z') }];
    const sources = createAttentionSources({
      projectRoot: root,
      pluginLifecycleFile: join(root, 'plugin-lifecycle.json'),
      snapshots: snapshots(),
      pluginManagement: {
        planInstall: async () => { throw new Error('unused'); },
        inspect: async (key: string) => {
          inspected.push(key);
          if (key === 'news') throw new Error('inspect failed');
          return management({ status: 'degraded', issues: ['Declared plugin package is not installed'] });
        },
      },
      configuration: { readSource: async () => ({}) },
      databaseHost: {
        started: true,
        models: { get: (name: string) => name === 'SystemLog' ? {
          count: async (where: Record<string, unknown>) => where.level === 'error' ? 3 : 0,
          select: () => { const selection = { where: () => selection, orderBy: () => selection, limit: async () => rows, then: (resolve: (value: unknown) => unknown) => resolve(rows) }; return selection; },
        } : undefined },
      },
    } as unknown as ConsoleRpcComposition);
    const list = await collectAttention(sources, { allows: () => true });
    expect(inspected.sort()).toEqual(['news', 'weather']);
    expect(list.items.map(item => item.kind)).toEqual(['plugin.error', 'mcp.disconnected', 'logs.errors']);
    expect(list.items.find(item => item.kind === 'logs.errors')).toMatchObject({ since: '2026-11-13T07:00:00.000Z', title: '日志里有 3 条错误' });
    // One plugin could not be inspected: the plugin source is reported incomplete.
    expect(list.unavailable).toEqual(['plugins']);
  });

  it('reports the log store unavailable when the database has not started', async () => {
    const sources = createAttentionSources({
      projectRoot: '/nonexistent', pluginLifecycleFile: '/nonexistent/l.json',
      configuration: { readSource: async () => ({}) },
      databaseHost: { started: false, models: { get: () => undefined } },
    } as unknown as ConsoleRpcComposition);
    expect((await collectAttention(sources, { allows: () => true })).unavailable).toEqual(['logs']);
  });
});
