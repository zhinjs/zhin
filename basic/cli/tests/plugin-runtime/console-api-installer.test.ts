import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHttpHost, type HttpHost } from '@zhin.js/host-http';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import type { ImRuntime } from '@zhin.js/core/runtime';
import type { RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import {
  buildConsoleEntriesBody,
  buildConsoleStats,
  buildPluginListItem,
  getSystemStatusData,
  listSnapshotPlugins,
  registerConsoleApiRoutes,
} from '../../src/plugin-runtime/console-api-installer.js';

const hosts: HttpHost[] = [];
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const pages = Object.freeze([
  Object.freeze({
    id: 'cap-1',
    localName: 'sandbox',
    title: 'Sandbox',
    route: '/sandbox',
    module: '/assets/client/sandbox.js',
    order: 10,
    hash: 'abc',
  }),
  Object.freeze({
    id: 'cap-2',
    localName: 'icqq',
    title: 'ICQQ',
    route: '/icqq',
    module: '/assets/client/icqq.js',
    order: 20,
    hash: 'def',
  }),
]);

function stubConsoleRuntime(): ConsoleRuntime {
  return {
    runView: async (_access: unknown, operation: (catalog: unknown) => unknown) =>
      operation({ pages: () => pages }),
  } as unknown as ConsoleRuntime;
}

function stubIm(): ImRuntime {
  return {
    listEndpoints: () => [
      { name: 'bot', adapter: 'sandbox', connected: true, status: 'online' },
      { name: 'bot-2', adapter: 'icqq', connected: false, status: 'offline' },
    ],
  } as unknown as ImRuntime;
}

function stubSnapshot(packageRoot: string): () => RuntimeSnapshot {
  const snapshot = {
    generation: 1,
    root: 'root',
    tree: new Map([
      ['root', {
        id: 'root',
        instanceKey: 'root',
        packageName: 'root',
        packageRoot,
        children: ['plugin-1'],
      }],
      ['plugin-1', {
        id: 'plugin-1',
        instanceKey: 'icqq',
        packageName: '@zhin.js/adapter-icqq',
        packageRoot,
        parent: 'root',
        children: [],
        metadata: { displayName: 'ICQQ' },
      }],
    ]),
    config: new Map(),
    resources: new Map(),
    capabilities: new Map(),
    projections: new Map(),
  } as unknown as RuntimeSnapshot;
  return () => snapshot;
}

async function startHost(options: {
  withTokens?: boolean;
  projectRoot: string;
  snapshot?: () => RuntimeSnapshot;
}): Promise<{ port: number }> {
  const host = createHttpHost({
    host: '127.0.0.1',
    port: 0,
    ...(options.withTokens
      ? { token: 'full-token', tokens: [{ token: 'demo-token', scope: 'demo' as const }] }
      : {}),
  });
  hosts.push(host);
  registerConsoleApiRoutes(
    host,
    stubConsoleRuntime(),
    options.projectRoot,
    '/api',
    stubIm(),
    undefined,
    undefined,
    options.snapshot,
  );
  return host.listen();
}

async function makePackageRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'zhin-console-api-'));
  tempRoots.push(dir);
  await mkdir(join(dir, 'node_modules', 'fake'), { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'proj' }));
  const packageRoot = join(dir, 'node_modules', 'fake');
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    name: '@zhin.js/adapter-icqq',
    version: '1.2.3',
  }));
  return packageRoot;
}

describe('console entries builder', () => {
  it('maps pages to the SDK ConsoleEntriesResponse shape', () => {
    const body = buildConsoleEntriesBody(pages, 'development');
    expect(body.runtimeEnvHint).toBe('development');
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]).toMatchObject({
      id: 'sandbox',
      name: 'sandbox',
      title: 'Sandbox',
      module: '/assets/client/sandbox.js',
      resolvedModule: '/assets/client/sandbox.js',
      order: 10,
      enabled: true,
      meta: { name: 'Sandbox' },
    });
  });
});

describe('system status / stats builders', () => {
  it('reports the legacy status fields with real process data', () => {
    const status = getSystemStatusData();
    expect(status.runtime).toBe('node');
    expect(status.platform).toBe(process.platform);
    expect(status.nodeVersion).toBe(process.version);
    expect(status.pid).toBe(process.pid);
    expect(typeof status.uptime).toBe('number');
    expect(typeof status.memory.heapUsed).toBe('number');
    expect(typeof status.osMemory?.totalMem).toBe('number');
    expect(typeof status.timestamp).toBe('string');
  });

  it('builds dashboard stats from plugin and endpoint counts', () => {
    const stats = buildConsoleStats(3, [
      { status: 'online' },
      { status: 'offline' },
      { status: 'online' },
    ]);
    expect(stats.plugins).toEqual({ total: 3, active: 3 });
    expect(stats.endpoints).toEqual({ total: 3, online: 2 });
    expect(typeof stats.memory).toBe('number');
    expect(stats.runtime).toBe('node');
  });
});

describe('plugin list helpers', () => {
  it('excludes the root node and maps snapshot nodes to list items', async () => {
    const packageRoot = await makePackageRoot();
    const nodes = listSnapshotPlugins(stubSnapshot(packageRoot)());
    expect(nodes).toHaveLength(1);
    expect(buildPluginListItem(nodes[0])).toEqual({
      name: 'icqq',
      status: 'active',
      description: 'ICQQ',
      features: [],
      packageName: '@zhin.js/adapter-icqq',
      instanceKey: 'icqq',
    });
  });

  it('returns an empty list without a snapshot', () => {
    expect(listSnapshotPlugins(undefined)).toEqual([]);
  });
});

describe('console REST routes', () => {
  let projectRoot: string;
  let packageRoot: string;

  beforeEach(async () => {
    packageRoot = await makePackageRoot();
    projectRoot = tempRoots[tempRoots.length - 1];
  });

  it('serves GET /entries without a token (public path)', async () => {
    const { port } = await startHost({ projectRoot, withTokens: true });
    const res = await fetch(`http://127.0.0.1:${port}/entries`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      entries: Array<Record<string, unknown>>;
      runtimeEnvHint: string;
    };
    expect(Array.isArray(body.entries)).toBe(true);
    expect(['development', 'production']).toContain(body.runtimeEnvHint);
    expect(body.entries[0]).toMatchObject({
      id: 'sandbox',
      resolvedModule: '/assets/client/sandbox.js',
      enabled: true,
      meta: { name: 'Sandbox' },
    });
  });

  it('serves status/stats/plugins with a full-scope token', async () => {
    const { port } = await startHost({
      projectRoot,
      withTokens: true,
      snapshot: stubSnapshot(packageRoot),
    });
    const headers = { authorization: 'Bearer full-token' };

    const status = await fetch(`http://127.0.0.1:${port}/api/system/status`, { headers });
    expect(status.status).toBe(200);
    const statusBody = await status.json() as { success: boolean; data: Record<string, unknown> };
    expect(statusBody.success).toBe(true);
    expect(statusBody.data.runtime).toBe('node');
    expect(typeof statusBody.data.uptime).toBe('number');

    const stats = await fetch(`http://127.0.0.1:${port}/api/stats`, { headers });
    expect(stats.status).toBe(200);
    const statsBody = await stats.json() as {
      success: boolean;
      data: {
        plugins: { total: number; active: number };
        endpoints: { total: number; online: number };
        memory: number;
      };
    };
    expect(statsBody.data.plugins).toEqual({ total: 1, active: 1 });
    expect(statsBody.data.endpoints).toEqual({ total: 2, online: 1 });

    const plugins = await fetch(`http://127.0.0.1:${port}/api/plugins`, { headers });
    expect(plugins.status).toBe(200);
    const pluginsBody = await plugins.json() as {
      success: boolean;
      total: number;
      data: Array<Record<string, unknown>>;
    };
    expect(pluginsBody.total).toBe(1);
    expect(pluginsBody.data[0]).toMatchObject({
      name: 'icqq',
      status: 'active',
      description: 'ICQQ',
      packageName: '@zhin.js/adapter-icqq',
    });

    const detail = await fetch(`http://127.0.0.1:${port}/api/plugins/icqq`, { headers });
    expect(detail.status).toBe(200);
    const detailBody = await detail.json() as { success: boolean; data: Record<string, unknown> };
    expect(detailBody.data).toMatchObject({
      name: 'icqq',
      status: 'active',
      version: '1.2.3',
      filePath: packageRoot,
    });

    const missing = await fetch(`http://127.0.0.1:${port}/api/plugins/nope`, { headers });
    expect(missing.status).toBe(404);
  });

  it('resolves plugin detail by scoped package name', async () => {
    const { port } = await startHost({
      projectRoot,
      withTokens: true,
      snapshot: stubSnapshot(packageRoot),
    });
    const headers = { authorization: 'Bearer full-token' };
    const name = encodeURIComponent('@zhin.js/adapter-icqq');
    const res = await fetch(`http://127.0.0.1:${port}/api/plugins/${name}`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Record<string, unknown> };
    expect(body.data.instanceKey).toBe('icqq');
  });

  it('applies the demo scope HTTP matrix', async () => {
    const { port } = await startHost({
      projectRoot,
      withTokens: true,
      snapshot: stubSnapshot(packageRoot),
    });
    const demo = { authorization: 'Bearer demo-token' };

    for (const path of [
      '/api/system/status',
      '/api/stats',
      '/api/plugins',
      '/api/plugins/icqq',
    ]) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: demo });
      expect(res.status, `demo GET ${path}`).toBe(200);
    }

    // 只读放行之外的路径仍拒绝 demo。
    const jobs = await fetch(`http://127.0.0.1:${port}/api/assistant/jobs`, { headers: demo });
    expect(jobs.status).toBe(401);

    // 无 token 访问受保护路径 401；/entries 公开。
    const denied = await fetch(`http://127.0.0.1:${port}/api/system/status`);
    expect(denied.status).toBe(401);
    const entries = await fetch(`http://127.0.0.1:${port}/entries`);
    expect(entries.status).toBe(200);
  });

  it('works without a snapshot accessor (empty plugin list)', async () => {
    const { port } = await startHost({ projectRoot, withTokens: true });
    const headers = { authorization: 'Bearer full-token' };
    const res = await fetch(`http://127.0.0.1:${port}/api/plugins`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as { total: number; data: unknown[] };
    expect(body.total).toBe(0);
    expect(body.data).toEqual([]);
  });
});
