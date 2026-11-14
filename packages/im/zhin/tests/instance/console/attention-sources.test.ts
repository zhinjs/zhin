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
    let dependencyChecks = 0;
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
        checkDependencies: async () => { dependencyChecks += 1; return { status: 'passed' }; },
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
    expect(dependencyChecks).toBe(1);
    // One plugin could not be inspected: it gets its own item with the reason, the other plugin's item stays.
    expect(list.items.map(item => item.id)).toEqual(['plugin.error:plugin=news', 'plugin.error:plugin=weather', 'mcp.disconnected:mcpServer=search', 'logs.errors']);
    expect(list.items[0]).toMatchObject({ title: '无法读取插件 news 的状态', detail: '原因：inspect failed', action: { path: '/plugins/news' } });
    expect(list.items[1]).toMatchObject({ title: '插件 weather 运行异常', detail: 'Declared plugin package is not installed' });
    expect(list.items.find(item => item.kind === 'logs.errors')).toMatchObject({ since: '2026-11-13T07:00:00.000Z', title: '最近 24 小时日志里有 3 条错误' });
    expect(list.unavailable).toBeUndefined();
    // The cache revision follows the generation and the project files.
    const before = await sources.revision!();
    expect(before).toMatch(/^0\|\d/u);
    expect(await sources.revision!()).toBe(before);
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ configVersion: 2, plugins: { weather: 'weather-pkg' } }));
    expect(await sources.revision!()).not.toBe(before);
  });

  it('checks the project dependency graph once for N plugins and reports one item when it fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-attention-deps-'));
    roots.push(root);
    const keys = ['weather', 'news', 'music', 'rss'];
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'root', dependencies: Object.fromEntries(keys.map(key => [`${key}-pkg`, '*'])), zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
    await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ configVersion: 2, plugins: Object.fromEntries(keys.map(key => [key, `${key}-pkg`])) }));
    const inspectOptions: unknown[] = [];
    let dependencyChecks = 0;
    const sources = createAttentionSources({
      projectRoot: root, pluginLifecycleFile: join(root, 'plugin-lifecycle.json'), snapshots: snapshots(),
      pluginManagement: {
        planInstall: async () => { throw new Error('unused'); },
        inspect: async (key: string, options?: unknown) => { inspectOptions.push(options); return management({ instanceKey: key, dependencies: 'unchecked' }); },
        checkDependencies: async () => { dependencyChecks += 1; return { status: 'failed', error: 'Package dependency cycle detected at music-pkg' }; },
      },
      configuration: { readSource: async () => ({}) },
    } as unknown as ConsoleRpcComposition);
    const list = await collectAttention({ plugins: sources.plugins }, { allows: () => true });
    expect(dependencyChecks).toBe(1);
    expect(inspectOptions).toEqual(keys.map(() => ({ dependencies: 'skip' })));
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ kind: 'plugin.dependencies', id: 'plugin.dependencies', detail: 'Package dependency cycle detected at music-pkg', action: { path: '/plugins' } });
  });

  it('counts error logs with a count query only, never by loading rows', async () => {
    let selected = 0;
    const sources = createAttentionSources({
      projectRoot: '/nonexistent', pluginLifecycleFile: '/nonexistent/l.json',
      configuration: { readSource: async () => ({}) },
      databaseHost: { started: true, models: { get: () => ({ select: () => { selected += 1; throw new Error('must not select rows'); } }) } },
    } as unknown as ConsoleRpcComposition);
    expect(await sources.errorLogs!()).toBeNull();
    expect(selected).toBe(0);
    expect((await collectAttention({ errorLogs: sources.errorLogs }, { allows: () => true })).unavailable).toEqual(['logs']);
  });

  it('counts only error logs inside the window, so an old error does not keep the item lit', async () => {
    const now = Date.parse('2026-11-14T12:00:00.000Z');
    const queries: Record<string, unknown>[] = [];
    const sources = createAttentionSources({
      projectRoot: '/nonexistent', pluginLifecycleFile: '/nonexistent/l.json',
      configuration: { readSource: async () => ({}) },
      databaseHost: { started: true, models: { get: () => ({
        count: async (where: Record<string, unknown>) => { queries.push(where); return 0; },
        select: () => { throw new Error('must not select rows when nothing is in the window'); },
      }) } },
    } as unknown as ConsoleRpcComposition, { now: () => now, errorLogWindowHours: 6 });
    expect(await sources.errorLogs!()).toEqual({ count: 0, latest: null, windowHours: 6 });
    expect(queries).toEqual([{ level: 'error', timestamp: { $gte: new Date('2026-11-14T06:00:00.000Z') } }]);
    expect((await collectAttention({ errorLogs: sources.errorLogs }, { allows: () => true })).items).toEqual([]);
  });

  it('says which period the error-log item covers', async () => {
    const list = await collectAttention({ errorLogs: async () => ({ count: 2, latest: '2026-11-14T11:00:00.000Z', windowHours: 24 }) }, { allows: () => true });
    expect(list.items[0]).toMatchObject({ kind: 'logs.errors', title: '最近 24 小时日志里有 2 条错误' });
    expect(list.items[0]!.detail).toContain('最近 24 小时');
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
