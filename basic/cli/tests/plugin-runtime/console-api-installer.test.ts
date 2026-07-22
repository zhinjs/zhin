import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHttpHost, createConsoleEventHub, type HttpHost } from '@zhin.js/host-http';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import type { ImRuntime, RuntimeMessageEvent } from '@zhin.js/core/runtime';
import {
  createCapabilitySlot,
  featureId,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import {
  buildConsoleEntriesBody,
  buildConsoleStats,
  buildPluginDetail,
  buildPluginFeatures,
  buildPluginListItem,
  displayConsolePath,
  flattenConfigDocument,
  getSystemStatusData,
  jsonSchemaToConsoleSchema,
  listSnapshotPlugins,
  registerConsoleApiRoutes,
  writeConfigKey,
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
      { name: 'bot', adapter: 'sandbox', owner: 'root/sandbox', connected: true, status: 'online' },
      { name: '123456', adapter: 'icqq', owner: 'plugin-1', connected: false, status: 'offline' },
    ],
  } as unknown as ImRuntime;
}

function stubSnapshot(packageRoot: string, withFeatures = true): () => RuntimeSnapshot {
  const adapterSlot = createCapabilitySlot({
    owner: 'plugin-1' as RuntimeSnapshot['root'],
    feature: featureId('zhin.adapter'),
    localName: 'default',
    source: join(packageRoot, 'adapters/default.ts'),
    definition: {},
  });
  const commandSlot = createCapabilitySlot({
    owner: 'plugin-1' as RuntimeSnapshot['root'],
    feature: featureId('zhin.command'),
    localName: 'ping',
    source: join(packageRoot, 'commands/ping.ts'),
    definition: {},
  });
  const otherCommand = createCapabilitySlot({
    owner: 'root' as RuntimeSnapshot['root'],
    feature: featureId('zhin.command'),
    localName: 'help',
    source: join(packageRoot, 'commands/help.ts'),
    definition: {},
  });
  const capabilities = withFeatures
    ? new Map([
      [adapterSlot.id, adapterSlot],
      [commandSlot.id, commandSlot],
      [otherCommand.id, otherCommand],
    ])
    : new Map();
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
    capabilities,
    projections: new Map(),
  } as unknown as RuntimeSnapshot;
  return () => snapshot;
}

async function startHost(options: {
  withTokens?: boolean;
  projectRoot: string;
  snapshot?: () => RuntimeSnapshot;
  primaryConfigDocument?: Readonly<Record<string, unknown>>;
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
    undefined,
    undefined,
    options.primaryConfigDocument,
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
    const snap = stubSnapshot(packageRoot)();
    const nodes = listSnapshotPlugins(snap);
    expect(nodes).toHaveLength(1);
    expect(buildPluginListItem(nodes[0], snap)).toEqual({
      name: 'icqq',
      status: 'active',
      description: 'ICQQ',
      features: [
        {
          name: 'adapter',
          icon: 'Cable',
          desc: '适配器',
          count: 1,
          items: [{ name: 'default' }],
        },
        {
          name: 'command',
          icon: 'Terminal',
          desc: '命令',
          count: 1,
          items: [{ name: 'ping' }],
        },
      ],
      packageName: '@zhin.js/adapter-icqq',
      instanceKey: 'icqq',
    });
  });

  it('returns empty features without a snapshot argument', async () => {
    const packageRoot = await makePackageRoot();
    const nodes = listSnapshotPlugins(stubSnapshot(packageRoot)());
    expect(buildPluginListItem(nodes[0])).toMatchObject({ features: [] });
  });

  it('enriches adapter feature items with live endpoint names', async () => {
    const packageRoot = await makePackageRoot();
    const snap = stubSnapshot(packageRoot)();
    const node = listSnapshotPlugins(snap)[0]!;
    const features = buildPluginFeatures(node, snap, [
      { name: '123456', adapter: 'icqq', owner: 'plugin-1', connected: true },
      { name: 'sandbox-bot', adapter: 'sandbox', owner: 'root/sandbox', connected: false },
    ]);
    const adapter = features.find((f) => f.name === 'adapter');
    expect(adapter).toMatchObject({
      count: 1,
      items: [{ name: '123456', desc: 'online' }],
    });
  });

  it('does not attribute other plugins\' capabilities', async () => {
    const packageRoot = await makePackageRoot();
    const snap = stubSnapshot(packageRoot)();
    const node = listSnapshotPlugins(snap)[0]!;
    const features = buildPluginFeatures(node, snap);
    const command = features.find((f) => f.name === 'command');
    expect(command?.items.map((i) => i.name)).toEqual(['ping']);
    expect(command?.items.map((i) => i.name)).not.toContain('help');
  });

  it('returns an empty list without a snapshot', () => {
    expect(listSnapshotPlugins(undefined)).toEqual([]);
  });

  it('shortens absolute packageRoot to ./… under project root', async () => {
    const packageRoot = await makePackageRoot();
    const projectRoot = tempRoots[tempRoots.length - 1];
    const node = listSnapshotPlugins(stubSnapshot(packageRoot)())[0]!;
    const detail = buildPluginDetail(node, '1.0.0', undefined, undefined, projectRoot);
    expect(detail.filePath).toBe('./node_modules/fake');
    expect(detail.filename).toBe('./node_modules/fake');
    expect(detail.version).toBe('1.0.0');
  });
});

describe('displayConsolePath', () => {
  const projectRoot = '/Users/demo/IdeaProjects/zhin/examples/test-bot';
  const homeDir = '/Users/demo';

  it('maps workspace paths to ./…', () => {
    expect(displayConsolePath(
      `${projectRoot}/plugins/hello/commands/ping.ts`,
      projectRoot,
    )).toBe('./plugins/hello/commands/ping.ts');
  });

  it('leaves logical source names untouched', () => {
    expect(displayConsolePath('agent', projectRoot)).toBe('agent');
    expect(displayConsolePath('builtin', projectRoot)).toBe('builtin');
    expect(displayConsolePath('./relative.ts', projectRoot)).toBe('./relative.ts');
  });

  it('maps paths under home (outside project) via formatDisplayPath default home', () => {
    // 依赖当前进程 HOME；若 project 不在 home 下则保留绝对路径也合法
    const outside = join(homeDir, 'IdeaProjects/zhin/zhin.config.yml');
    const out = displayConsolePath(outside, projectRoot);
    // 在常见 mac 开发机 home 下会变成 ~/…；否则至少不是 project 前缀泄露
    expect(out === outside || out.startsWith('~/')).toBe(true);
    expect(out.includes(projectRoot)).toBe(false);
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
    // features 从 snapshot.capabilities 聚合；adapter items 用 live endpoint 名
    const listFeatures = pluginsBody.data[0].features as Array<Record<string, unknown>>;
    expect(listFeatures.some((f) => f.name === 'command')).toBe(true);
    const listAdapter = listFeatures.find((f) => f.name === 'adapter') as {
      items: Array<{ name: string; desc?: string }>;
    };
    expect(listAdapter.items).toEqual([{ name: '123456', desc: 'offline' }]);

    const detail = await fetch(`http://127.0.0.1:${port}/api/plugins/icqq`, { headers });
    expect(detail.status).toBe(200);
    const detailBody = await detail.json() as { success: boolean; data: Record<string, unknown> };
    expect(detailBody.data).toMatchObject({
      name: 'icqq',
      status: 'active',
      version: '1.2.3',
      // 绝对 packageRoot 按 workspace 规则缩短为 ./…
      filePath: './node_modules/fake',
      filename: './node_modules/fake',
    });
    const detailFeatures = detailBody.data.features as Array<Record<string, unknown>>;
    expect(detailFeatures.some((f) => f.name === 'command')).toBe(true);
    expect(detailFeatures.some((f) => f.name === 'adapter')).toBe(true);

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

  it('serves config from the generation Primary Config instead of stale disk state', async () => {
    await writeFile(join(projectRoot, 'zhin.config.yml'), 'http:\n  port: 1000\n');
    const { port } = await startHost({
      projectRoot,
      primaryConfigDocument: {
        http: { port: 8086, token: '${HTTP_TOKEN}' },
        plugins: { sandbox: { endpoints: [] } },
      },
    });
    const response = await fetch(`http://127.0.0.1:${port}/api/console/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'config:get-all', requestId: 7 }),
    });
    const body = await response.json() as { data: Record<string, unknown> };
    expect(body.data).toEqual({
      http: { port: 8086, token: '${HTTP_TOKEN}' },
      sandbox: { endpoints: [] },
    });
  });
});

describe('console SSE events', () => {
  let projectRoot: string;

  beforeEach(async () => {
    await makePackageRoot();
    projectRoot = tempRoots[tempRoots.length - 1];
  });

  it('streams sync/init-data then fans out message events from ImRuntime', async () => {
    let messageListener: ((event: RuntimeMessageEvent) => void) | undefined;
    const im = {
      listEndpoints: () => [],
      onMessage(listener: (event: RuntimeMessageEvent) => void) {
        messageListener = listener;
        return () => { messageListener = undefined; };
      },
    } as unknown as ImRuntime;
    const hub = createConsoleEventHub();
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    registerConsoleApiRoutes(
      host, stubConsoleRuntime(), projectRoot, '/api',
      im, undefined, undefined, undefined, undefined, hub,
    );
    const { port } = await host.listen();

    const res = await fetch(`http://127.0.0.1:${port}/api/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    const readUntil = async (marker: string): Promise<string> => {
      let buffer = '';
      for (let attempt = 0; attempt < 50 && !buffer.includes(marker); attempt += 1) {
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`timeout waiting for ${marker}`)), 5_000);
          }),
        ]);
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      expect(buffer).toContain(marker);
      return buffer;
    };

    const first = await readUntil('event: init-data');
    expect(first).toContain('event: sync');
    expect(first).toContain('"key":"pages"');

    // 等 hub 订阅挂上再发事件
    for (let attempt = 0; attempt < 50 && hub.subscriberCount === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(hub.subscriberCount).toBe(1);

    messageListener?.({
      direction: 'inbound',
      adapter: 'root\0zhin.adapter\0icqq' as RuntimeMessageEvent['adapter'],
      target: 'group:42',
      sender: 'alice',
      channelType: 'group',
      contentPreview: 'hello console',
      messageId: 'msg-1',
      timestamp: 1_700_000_000_000,
    });

    const frames = await readUntil('event: message.receive');
    expect(frames).toContain('event: endpoint:message');
    expect(frames).toContain('"adapter":"icqq"');
    expect(frames).toContain('"endpoint":"icqq"');
    expect(frames).toContain('"sender":"alice"');
    expect(frames).toContain('"content":"hello console"');
    expect(frames).toContain('"direction":"inbound"');

    // 出站 → message.receive（direction: outbound）
    messageListener?.({
      direction: 'outbound',
      adapter: 'root\0zhin.adapter\0icqq' as RuntimeMessageEvent['adapter'],
      target: 'group:42',
      requester: 'root' as RuntimeMessageEvent['requester'],
      contentPreview: 'reply text',
      timestamp: 1_700_000_000_001,
    });
    const outbound = await readUntil('"direction":"outbound"');
    expect(outbound).toContain('"content":"reply text"');

    reader.cancel().catch(() => undefined);
  });

  it('publishes config:updated over SSE after config:set RPC', async () => {
    const hub = createConsoleEventHub();
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    registerConsoleApiRoutes(
      host, stubConsoleRuntime(), projectRoot, '/api',
      undefined, undefined, undefined, undefined, undefined, hub,
    );
    const { port } = await host.listen();

    const res = await fetch(`http://127.0.0.1:${port}/api/events`);
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const pending = (async () => {
      let buffer = '';
      for (let attempt = 0; attempt < 50 && !buffer.includes('event: config:updated'); attempt += 1) {
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('timeout waiting for config:updated')), 5_000);
          }),
        ]);
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      return buffer;
    })();

    for (let attempt = 0; attempt < 50 && hub.subscriberCount === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(hub.subscriberCount).toBe(1);

    const rpc = await fetch(`http://127.0.0.1:${port}/api/console/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'config:set',
        requestId: 1,
        pluginName: 'http',
        data: { port: 8086 },
      }),
    });
    expect(rpc.status).toBe(200);

    const frames = await pending;
    expect(frames).toContain('event: config:updated');
    expect(frames).toContain('"pluginName":"http"');
    expect(frames).toContain('"keys":["port"]');

    reader.cancel().catch(() => undefined);
  });
});

describe('config document flatten / write namespace', () => {
  it('flattens plugins.<key> to top-level for Console config:get-all', () => {
    const flat = flattenConfigDocument({
      http: { port: 8086 },
      plugins: {
        sandbox: { endpoints: [{ name: 'bot' }] },
        icqq: { name: '123' },
      },
    });
    expect(flat.http).toEqual({ port: 8086 });
    expect(flat.sandbox).toEqual({ endpoints: [{ name: 'bot' }] });
    expect(flat.icqq).toEqual({ name: '123' });
    expect(flat.plugins).toBeUndefined();
  });

  it('writes host keys to top-level and plugins under plugins.*', () => {
    const document: Record<string, unknown> = { plugins: { sandbox: {} } };
    writeConfigKey(document, 'http', { port: 9 });
    writeConfigKey(document, 'sandbox', { endpoints: [] });
    writeConfigKey(document, 'new-plugin', { enabled: true });
    expect(document.http).toEqual({ port: 9 });
    expect((document.plugins as Record<string, unknown>).sandbox).toEqual({ endpoints: [] });
    expect((document.plugins as Record<string, unknown>)['new-plugin']).toEqual({ enabled: true });
  });

  it('promotes plugins:[] array form to a map without dropping listed names', () => {
    const document: Record<string, unknown> = { plugins: ['sandbox', 'icqq'] };
    writeConfigKey(document, 'sandbox', { endpoints: [{ name: 'bot' }] });
    expect(document.plugins).toEqual({
      sandbox: { endpoints: [{ name: 'bot' }] },
      icqq: {},
    });
  });
});

describe('jsonSchemaToConsoleSchema', () => {
  it('converts object properties to Console Schema object map', () => {
    const consoleSchema = jsonSchemaToConsoleSchema({
      type: 'object',
      properties: {
        name: { type: 'string', description: 'QQ uin' },
        autoReconnect: { type: 'boolean', default: true },
        endpoints: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        },
      },
      required: ['name'],
    });
    expect(consoleSchema).toMatchObject({
      type: 'object',
      object: {
        name: { type: 'string', key: 'name', description: 'QQ uin', required: true },
        autoReconnect: { type: 'boolean', key: 'autoReconnect', default: true },
        endpoints: {
          type: 'list',
          key: 'endpoints',
          inner: {
            type: 'object',
            object: {
              name: { type: 'string', key: 'name', required: true },
            },
            // dual-emit for PluginConfigForm nested list items
            dict: {
              name: { type: 'string', key: 'name', required: true },
            },
            properties: {
              name: { type: 'string', key: 'name', required: true },
            },
          },
        },
      },
      // top-level dual-emit
      dict: expect.any(Object),
      properties: expect.any(Object),
    });
    expect(consoleSchema?.dict).toEqual(consoleSchema?.object);
    expect(consoleSchema?.properties).toEqual(consoleSchema?.object);
  });

  it('maps enum to options and integer to number', () => {
    const consoleSchema = jsonSchemaToConsoleSchema({
      type: 'object',
      properties: {
        outboundMedia: { type: 'string', enum: ['file', 'base64'] },
        port: { type: 'integer', minimum: 1, maximum: 65535 },
      },
    });
    expect(consoleSchema?.object).toMatchObject({
      outboundMedia: {
        type: 'string',
        options: [
          { label: 'file', value: 'file' },
          { label: 'base64', value: 'base64' },
        ],
      },
      port: { type: 'number', min: 1, max: 65535 },
    });
  });

  it('passes through already-converted Console Schema JSON', () => {
    const input = {
      type: 'object',
      object: { name: { type: 'string', key: 'name' } },
    };
    expect(jsonSchemaToConsoleSchema(input)).toEqual(input);
  });
});
