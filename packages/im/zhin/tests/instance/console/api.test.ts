import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { installTestConsoleUsers } from '../utils/console-users.js';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { createConfigDocument } from '@zhin.js/runtime';
// Load the Agent runtime once while the file is collected: its cold transform takes ~8 s from
// source, which ran inside the first Agent test's 10 s budget and timed out under suite load.
// The tests below still `await import()` it so the Console's lazy loader sees it cached.
import '@zhin.js/agent/runtime';
import { createConsoleEventHub, type HttpHost } from '@zhin.js/host-http';
import { createHttpHost } from '@zhin.js/host-http/node';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import type { ImRuntime, RuntimeMessageEvent } from '@zhin.js/core/runtime';
import {
  createCapabilitySlot,
  featureId,
  rootPluginId,
  tokenId,
  type RuntimeSnapshot,
  type SnapshotReader,
} from '@zhin.js/plugin-runtime';
import { registerConsoleRoutes } from '../../../src/instance/console/api-routes.js';
import { ConsoleConfigurationStore } from '../../../../../host/gateway/src/config/configuration.js';
import { isKnownConversationSession } from '../../../src/instance/console/conversation-session.js';
import { ConsoleMessageBindings } from '../../../src/instance/console/message-bindings.js';
import {
  resolveGenerationAgentConsole,
  resolveGenerationAgentIntrospection,
} from '../../../src/instance/console/agent-console.js';
import {
  buildConsoleEntriesBody,
} from '../../../src/instance/console/entry-projection.js';
import { displayConsolePath } from '../../../src/instance/console/display-path.js';
import {
  buildPluginDetail,
  buildPluginFeatures,
  buildPluginListItem,
  listSnapshotPlugins,
} from '../../../src/instance/console/plugin-projection.js';
import {
  buildConsoleStats,
  getSystemStatusData,
} from '../../../src/instance/console/system-projection.js';

const hosts: HttpHost[] = [];
const tempRoots: string[] = [];

function splitHostPorts(host: { console: Record<string, unknown> } & Record<string, unknown>) {
  return new Map<unknown, unknown>([
    [tokenId('zhin.host.agent'), host],
  ]);
}

describe('isKnownConversationSession', () => {
  it('matches the durable inbox using all four canonical session fields', async () => {
    const queries: Record<string, unknown>[] = [];
    const selection = {
      where(query: Record<string, unknown>) {
        queries.push(query);
        return this;
      },
      limit() {
        return Promise.resolve([{ id: 1 }]);
      },
    };
    const host = {
      started: true,
      models: { get: () => ({ select: () => selection }) },
    };

    await expect(isKnownConversationSession(
      host as Parameters<typeof isKnownConversationSession>[0],
      'icqq:main:group:room:thread',
    )).resolves.toBe(true);
    expect(queries).toEqual([{
      adapter: 'icqq', endpoint_id: 'main', channel_type: 'group', channel_id: 'room:thread',
    }]);
  });

  it('keeps the result unknown until the inbox model is available', async () => {
    await expect(isKnownConversationSession({
      started: false,
      models: { get: () => undefined },
    }, 'icqq:main:group:room')).resolves.toBeUndefined();
  });
});

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
    endpoints: {
      list: () => [
        { name: 'bot', adapter: 'sandbox', owner: 'root/sandbox', connected: true, status: 'online' },
        { name: '123456', adapter: 'icqq', owner: 'plugin-1', connected: false, status: 'offline' },
      ],
    },
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
    source: join(packageRoot, 'commands/ping/index.ts'),
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
  snapshots?: SnapshotReader;
}): Promise<{ port: number }> {
  const host = createHttpHost({ host: '127.0.0.1', port: 0 });
  // The removed demo token is now the built-in read-only `viewer` user (ADR 0049).
  if (options.withTokens) installTestConsoleUsers(host, { 'full-token': 'owner', 'demo-token': 'viewer', 'nobody-token': 'none' });
  hosts.push(host);
  registerConsoleRoutes({
    http: host,
    consoleRuntime: stubConsoleRuntime(),
    projectRoot: options.projectRoot,
    apiBase: '/api',
    im: stubIm(),
    eventHub: createConsoleEventHub(),
    snapshot: options.snapshot,
    configuration: configurationFor(options.projectRoot),
    snapshots: options.snapshots,
  });
  return host.listen();
}

function configurationFor(projectRoot: string): ConsoleConfigurationStore {
  return new ConsoleConfigurationStore({
    projectRoot,
    document: createConfigDocument(join(projectRoot, 'zhin.config.yml')),
  });
}

async function makePackageRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'zhin-console-api-'));
  tempRoots.push(dir);
  await mkdir(join(dir, 'node_modules', 'fake'), { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'proj' }));
  await writeFile(join(dir, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\n');
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
  it('reports status fields with real process data', () => {
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
      metadata: { displayName: 'ICQQ' },
      displayName: 'ICQQ',
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
      manageable: false,
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
    expect(detail.packageRoot).toBe('./node_modules/fake');
    expect(detail.version).toBe('1.0.0');
    expect(detail).not.toHaveProperty('filename');
    expect(detail).not.toHaveProperty('filePath');
    expect(detail).not.toHaveProperty('contexts');
    expect(detail).not.toHaveProperty('contextCount');
  });
});

describe('displayConsolePath', () => {
  const projectRoot = '/Users/demo/IdeaProjects/zhin/examples/test-bot';
  const homeDir = '/Users/demo';

  it('maps workspace paths to ./…', () => {
    expect(displayConsolePath(
      `${projectRoot}/plugins/hello/commands/ping/index.ts`,
      projectRoot,
    )).toBe('./plugins/hello/commands/ping/index.ts');
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

describe('generation-owned Agent introspection', () => {
  it('resolves the read-only port only from the snapshot root resource', () => {
    const root = rootPluginId();
    const token = { id: tokenId('zhin.host.agent') };
    const introspection = { listMcpServers: () => [] };
    const snapshot = {
      root,
      resources: new Map([[root, new Map([[token.id, { introspection }]])]]),
    } as unknown as RuntimeSnapshot;

    expect(resolveGenerationAgentIntrospection(snapshot, token)).toBe(introspection);
    expect(resolveGenerationAgentIntrospection(undefined, token)).toBeNull();
  });

  it('does not scan another owner as a fallback authority', () => {
    const root = rootPluginId();
    const child = `${root}/child` as RuntimeSnapshot['root'];
    const token = { id: tokenId('zhin.host.agent') };
    const snapshot = {
      root,
      resources: new Map([[child, new Map([[token.id, { introspection: {} }]])]]),
    } as unknown as RuntimeSnapshot;

    expect(resolveGenerationAgentIntrospection(snapshot, token)).toBeNull();
  });

  it('reads all Console Agent ports from the same root generation resource', () => {
    const root = rootPluginId();
    const agentToken = { id: tokenId('zhin.host.agent') };
    const agentConsole = { sessionTree: {}, assistant: null, trace: {}, engagements: {}, venues: {} };
    const snapshot = {
      root,
      resources: new Map([[root, new Map<unknown, unknown>([
        [agentToken.id, { console: agentConsole }],
      ])]]),
    } as unknown as RuntimeSnapshot;

    expect(resolveGenerationAgentConsole(snapshot, agentToken)).toEqual(agentConsole);
  });

  it('returns null when the Agent Host port is missing', () => {
    const root = rootPluginId();
    const agentToken = { id: tokenId('zhin.host.agent') };
    const snapshot = {
      root,
      resources: new Map([[root, new Map()]]),
    } as unknown as RuntimeSnapshot;

    expect(resolveGenerationAgentConsole(snapshot, agentToken)).toBeNull();
    expect(resolveGenerationAgentConsole(snapshot, undefined)).toBeNull();
  });
});

describe('console REST routes', () => {
  let projectRoot: string;
  let packageRoot: string;

  beforeEach(async () => {
    packageRoot = await makePackageRoot();
    projectRoot = tempRoots[tempRoots.length - 1];
  });

  it('returns forbidden for authenticated demo env RPC without exposing or changing the file', async () => {
    const original = 'FIXTURE_TOKEN=fake-private-value\n';
    await writeFile(join(projectRoot, '.env'), original);
    const { port } = await startHost({ projectRoot, withTokens: true });
    const request = (token: string, type: string) => fetch(`http://127.0.0.1:${port}/api/console/request`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type, filename: '.env', content: 'FIXTURE_TOKEN=forbidden-write\n', requestId: 77 }),
    });
    for (const type of ['env:list', 'env:get', 'env:save']) {
      const response = await request('demo-token', type);
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain('fake-private-value');
    }
    expect((await request('invalid-token', 'env:get')).status).toBe(401);
    expect((await request('full-token', 'env:get')).status).toBe(200);
    expect(await readFile(join(projectRoot, '.env'), 'utf8')).toBe(original);
  });

  it('diagnoses the exact instance using its declared package installation', async () => {
    await writeFile(join(projectRoot, 'package.json'), JSON.stringify({
      name: 'proj', dependencies: { '@zhin.js/adapter-icqq': '1.2.3' },
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts',
        plugins: [] },
    }));
    await writeFile(join(projectRoot, 'zhin.config.yml'), "configVersion: 2\nplugins: {custom-icqq: '@zhin.js/adapter-icqq'}\ncustom-icqq: {}\n");
    const installedRoot = join(projectRoot, 'node_modules', '@zhin.js', 'adapter-icqq');
    await mkdir(installedRoot, { recursive: true });
    await writeFile(join(installedRoot, 'package.json'), JSON.stringify({ name: '@zhin.js/adapter-icqq', version: '1.2.3', zhin: { protocol: 1, type: 'plugin', entry: './plugin.js', platformFeatures: false } }));
    await writeFile(join(installedRoot, 'plugin.js'), 'export default {};');
    const { port } = await startHost({ projectRoot });
    const response = await fetch(`http://127.0.0.1:${port}/api/console/request`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'plugin:diagnose', pluginName: 'custom-icqq', requestId: 1 }),
    });
    const body = await response.json();
    expect(body.data).toMatchObject({
      pluginName: 'custom-icqq', packageName: '@zhin.js/adapter-icqq', planScope: 'package',
      plan: { packageName: '@zhin.js/adapter-icqq', alreadyInstalled: true, alreadyDeclared: true },
    });
  });

  it('never advertises plugin management to a demo principal for loaded or disabled declarations', async () => {
    await writeFile(join(projectRoot, 'package.json'), JSON.stringify({
      name: 'proj', dependencies: { '@zhin.js/adapter-icqq': '*' },
      zhin: {protocol: 1, type: 'plugin', entry: './plugin.ts'},
    }));
    await writeFile(join(projectRoot, 'zhin.config.yml'), "configVersion: 2\nplugins: {icqq: '@zhin.js/adapter-icqq'}\n");
    for (const snapshot of [stubSnapshot(packageRoot), undefined]) {
      const { port } = await startHost({ projectRoot, withTokens: true, snapshot });
      for (const [token, manageable] of [['demo-token', false], ['full-token', true]] as const) {
        const headers = { authorization: `Bearer ${token}` };
        const list = await (await fetch(`http://127.0.0.1:${port}/api/plugins`, { headers })).json();
        const detail = await (await fetch(`http://127.0.0.1:${port}/api/plugins/icqq`, { headers })).json();
        expect(list.data.find((item: { instanceKey: string }) => item.instanceKey === 'icqq').manageable).toBe(manageable);
        expect(detail.data.manageable).toBe(manageable);
        expect(detail.data.readOnly).toBe(!manageable);
      }
    }
  });

  it('keeps loaded detail management eligibility aligned with the declared plugin list', async () => {
    await writeFile(join(projectRoot, 'package.json'), JSON.stringify({
      name: 'proj', zhin: {plugins: []},
    }));
    await writeFile(join(projectRoot, 'zhin.config.yml'), "configVersion: 2\nplugins: {icqq: '@zhin.js/adapter-icqq'}\n");
    const { port } = await startHost({ projectRoot, snapshot: stubSnapshot(packageRoot) });
    const list = await (await fetch(`http://127.0.0.1:${port}/api/plugins`)).json();
    const detail = await (await fetch(`http://127.0.0.1:${port}/api/plugins/icqq`)).json();
    expect(list.data.find((item: { instanceKey: string }) => item.instanceKey === 'icqq').manageable).toBe(true);
    expect(detail.data.manageable).toBe(true);
    expect(detail.data.features).toEqual(list.data[0].features);
    await writeFile(join(projectRoot, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\n');
    const unmanaged = await (await fetch(`http://127.0.0.1:${port}/api/plugins/icqq`)).json();
    expect(unmanaged.data.manageable).toBe(false);
  });

  it('serves the bounded generation-owned Agent Trace projection', async () => {
    await import('@zhin.js/agent/runtime');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const root = rootPluginId();
    const traceSnapshot = {
      sessionKey: 'discord:bot:group:room',
      events: [{ sequence: 4, type: 'tool_result', data: { toolName: 'lookup' } }],
      latestSequence: 4,
      activeTurnIds: ['turn-1'],
    };
    const snapshot = {
      root,
      resources: new Map([[root, splitHostPorts({
        console: {
          sessionTree: {},
          assistant: null,
          trace: { list: () => traceSnapshot },
        },
      })]]),
    } as unknown as RuntimeSnapshot;
    const snapshots = {
      acquire: () => ({ value: snapshot, active: true, release: () => undefined }),
    } as unknown as SnapshotReader;
    const { port } = await startHost({ projectRoot, withTokens: true, snapshots });

    const response = await fetch(
      `http://127.0.0.1:${port}/api/agent/traces?sessionKey=discord%3Abot%3Agroup%3Aroom`,
      { headers: { authorization: 'Bearer full-token' } },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, data: traceSnapshot });

    const demoResponse = await fetch(
      `http://127.0.0.1:${port}/api/agent/traces?sessionKey=discord%3Abot%3Agroup%3Aroom`,
      { headers: { authorization: 'Bearer nobody-token' } },
    );
    expect(demoResponse.status).toBe(403);
  });

  it('serves the persisted trace archive read-only to full-scope tokens only (#728)', async () => {
    const { createTurnTraceArchive, defaultTurnTraceDir } = await import('@zhin.js/agent/trace');
    const archive = createTurnTraceArchive(defaultTurnTraceDir(projectRoot), { secrets: [] });
    const base = {
      version: 1, principal: undefined, model_calls: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      tool_calls: [], budget: { extensions: [], continuations: 0 }, subagent_tasks: [], subagents: [], timeline: [],
      termination: { status: 'completed' }, dropped: 0,
    } as const;
    await archive.save({ ...base, turn_id: 'turn-a', session_key: 'qq:bot:private:alice', started_at: Date.now() - 1000, duration_ms: 10 } as never);
    await archive.save({ ...base, turn_id: 'turn-b', session_key: 'qq:bot:group:g1', started_at: Date.now(), duration_ms: 20,
      timeline: [{ at_ms: 1, kind: 'error', detail: 'token=sk-abcdefghijklmnopqrstu' }] } as never);
    const { port } = await startHost({ projectRoot, withTokens: true });
    const get = (path: string, token = 'full-token') => fetch(`http://127.0.0.1:${port}/api/agent/trace-archive/${path}`, { headers: { authorization: `Bearer ${token}` } });

    const sessions = await (await get('sessions')).json() as { data: Array<{ session_key: string }> };
    expect(sessions.data.map((s) => s.session_key)).toEqual(['qq:bot:group:g1', 'qq:bot:private:alice']);
    const turns = await (await get('turns?sessionKey=qq%3Abot%3Aprivate%3Aalice')).json() as { data: Array<{ turn_id: string }> };
    expect(turns.data.map((t) => t.turn_id)).toEqual(['turn-a']);
    const detail = await get('turn?turnId=turn-b');
    expect(detail.status).toBe(200);
    expect(JSON.stringify(await detail.json())).not.toContain('sk-abcdefghijklmnopqrstu');
    expect((await get('turn?turnId=missing')).status).toBe(404);
    expect((await get('turns?since=not-a-time')).status).toBe(400);
    expect((await get('sessions', 'nobody-token')).status).toBe(403);
    expect((await get('turn?turnId=turn-a', 'nobody-token')).status).toBe(403);
  });

  it('serves Engagement Collaboration Graph REST and RPC endpoints', async () => {
    await import('@zhin.js/agent/runtime');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const root = rootPluginId();
    const summary = {
      engagementId: 'eng-1',
      status: 'completed' as const,
      startedAt: 1000,
      endedAt: 2000,
      eventCount: 2,
      hops: 1,
      turns: 2,
      tokensUsed: 42,
      wallClockMs: 1000,
      participants: ['root', 'reviewer'],
    };
    const detail = {
      summary,
      events: [],
      board: [{ key: 'plan', value: 'ship it', version: 1, updatedBy: { kind: 'agent' as const, name: 'root' }, updatedAt: 1500 }],
    };
    const venues = [{
      key: 'dev-room',
      channel: { endpoint: { adapter: 'sandbox', id: 'bot' }, kind: 'group' as const, id: 'room-1' },
      floor: 'moderated' as const,
    }];
    const listEngagements = vi.fn(async () => [summary]);
    const getEngagement = vi.fn(async (id: string) => (id === 'eng-1' ? detail : null));
    const listVenues = vi.fn(() => venues);

    const snapshot = {
      root,
      resources: new Map([[root, splitHostPorts({
        console: {
          sessionTree: {},
          assistant: null,
          trace: { list: () => ({ sessionKey: '', events: [], latestSequence: 0, activeTurnIds: [] }) },
          engagements: {
            list: listEngagements,
            get: getEngagement,
          },
          venues: {
            list: listVenues,
          },
        },
      })]]),
    } as unknown as RuntimeSnapshot;
    const snapshots = {
      acquire: () => ({ value: snapshot, active: true, release: () => undefined }),
    } as unknown as SnapshotReader;
    const { port } = await startHost({ projectRoot, withTokens: true, snapshots });
    const headers = { authorization: 'Bearer full-token' };

    const listRes = await fetch(`http://127.0.0.1:${port}/api/agent/engagements?limit=10`, { headers });
    expect(listRes.status).toBe(200);
    await expect(listRes.json()).resolves.toEqual({ success: true, data: { engagements: [summary] } });
    expect(listEngagements).toHaveBeenCalledWith(10);

    const detailRes = await fetch(`http://127.0.0.1:${port}/api/agent/engagements/eng-1`, { headers });
    expect(detailRes.status).toBe(200);
    await expect(detailRes.json()).resolves.toEqual({ success: true, data: detail });

    const missingRes = await fetch(`http://127.0.0.1:${port}/api/agent/engagements/missing`, { headers });
    expect(missingRes.status).toBe(404);

    const venuesRes = await fetch(`http://127.0.0.1:${port}/api/agent/venues`, { headers });
    expect(venuesRes.status).toBe(200);
    await expect(venuesRes.json()).resolves.toEqual({ success: true, data: { venues } });

    const rpcList = await fetch(`http://127.0.0.1:${port}/api/console/request`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'agent.engagements.list', data: { limit: 5 }, requestId: 101 }),
    });
    expect(rpcList.status).toBe(200);
    await expect(rpcList.json()).resolves.toMatchObject({
      success: true,
      data: { engagements: [summary] },
      type: 'agent.engagements.list',
      requestId: 101,
    });

    const rpcGet = await fetch(`http://127.0.0.1:${port}/api/console/request`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'agent.engagements.get', data: { engagementId: 'eng-1' }, requestId: 102 }),
    });
    expect(rpcGet.status).toBe(200);
    await expect(rpcGet.json()).resolves.toMatchObject({
      success: true,
      data: detail,
      type: 'agent.engagements.get',
      requestId: 102,
    });

    const rpcVenues = await fetch(`http://127.0.0.1:${port}/api/console/request`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'agent.venues.list', requestId: 103 }),
    });
    expect(rpcVenues.status).toBe(200);
    await expect(rpcVenues.json()).resolves.toMatchObject({
      success: true,
      data: { venues },
      type: 'agent.venues.list',
      requestId: 103,
    });
  });

  it('cancels an active Agent task through the generation-owned console port', async () => {
    await import('@zhin.js/agent/runtime');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const root = rootPluginId();
    const cancelSession = vi.fn(() => true);
    const snapshot = {
      root,
      resources: new Map([[root, splitHostPorts({
        console: {
          sessionTree: {}, assistant: null,
          trace: { list: () => ({ sessionKey: '', events: [], latestSequence: 0, activeTurnIds: [] }) },
          cancelSession,
        },
      })]]),
    } as unknown as RuntimeSnapshot;
    const snapshots = {
      acquire: () => ({ value: snapshot, active: true, release: () => undefined }),
    } as unknown as SnapshotReader;
    const { port } = await startHost({ projectRoot, withTokens: true, snapshots });

    const response = await fetch(`http://127.0.0.1:${port}/api/agent/tasks/cancel`, {
      method: 'POST',
      headers: { authorization: 'Bearer full-token', 'content-type': 'application/json' },
      body: JSON.stringify({ sessionKey: 'sandbox:sandbox-bot:private:sandbox-user' }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, data: { cancelled: true } });
    expect(cancelSession).toHaveBeenCalledWith('sandbox:sandbox-bot:private:sandbox-user');
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
      packageRoot: './node_modules/fake',
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

  it('serves detail for a declared plugin that is not active', async () => {
    await writeFile(join(projectRoot, 'package.json'), JSON.stringify({
      name: 'proj', dependencies: { '@zhin.js/adapter-icqq': '*' },
      zhin: {protocol: 1, type: 'plugin', entry: './plugin.ts'},
    }));
    await writeFile(join(projectRoot, 'zhin.config.yml'), "configVersion: 2\nplugins: {icqq: '@zhin.js/adapter-icqq'}\ndisable_plugins: [icqq]\n");
    const packageDir = join(projectRoot, 'node_modules', '@zhin.js', 'adapter-icqq');
    await mkdir(packageDir, { recursive: true });
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({
      name: '@zhin.js/adapter-icqq',
      version: '1.2.0',
      zhin: {protocol: 1, type: 'plugin', entry: './plugin.js', metadata: {displayName: 'Inactive QQ', icon: 'Bot'}},
    }));

    const { port } = await startHost({ projectRoot, withTokens: true });
    const res = await fetch(`http://127.0.0.1:${port}/api/plugins/icqq`, {
      headers: { authorization: 'Bearer full-token' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      name: 'icqq',
      instanceKey: 'icqq',
      packageName: '@zhin.js/adapter-icqq',
      status: 'inactive',
      manageable: true,
      version: '1.2.0',
      packageRoot: './node_modules/@zhin.js/adapter-icqq',
      description: 'Inactive QQ · 已停用',
      metadata: {displayName: 'Inactive QQ', icon: 'Bot'},
      displayName: 'Inactive QQ',
      icon: 'Bot',
    });
  });

  it('applies the viewer permission HTTP matrix', async () => {
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

    // 写权限路径拒绝只读用户。
    const send = await fetch(`http://127.0.0.1:${port}/api/message/send`, { method: 'POST', headers: demo });
    expect(send.status).toBe(403);

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

  it('revision-checks config:replace-source and rejects invalid source', async () => {
    const { port } = await startHost({ projectRoot });
    const request = (body: Record<string, unknown>) => fetch(`http://127.0.0.1:${port}/api/console/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const sourceResponse = await request({ type: 'config:get-source', requestId: 1 });
    const sourceBody = await sourceResponse.json() as {
      data: { revision: string; format: string };
    };
    expect(sourceBody.data.format).toBe('yaml');
    const expectedRevision = sourceBody.data.revision;

    const bad = await request({
      type: 'config:replace-source',
      requestId: 2,
      source: 'http: [unclosed\n  port: }',
      expectedRevision,
    });
    expect(bad.status).toBe(400);
    const badBody = await bad.json() as { success: boolean; error: string };
    expect(badBody.success).toBe(false);
    expect(badBody.error).toContain('Cannot parse YAML config');
    // 非法 YAML 不得落盘
    expect(await readFile(join(projectRoot, 'zhin.config.yml'), 'utf8')).toBe('configVersion: 2\nplugins: {}\n');

    const good = await request({
      type: 'config:replace-source',
      requestId: 3,
      source: 'configVersion: 2\nplugins: {}\nhttp:\n  port: 8086\n',
      expectedRevision,
    });
    expect(good.status).toBe(200);
    const saved = await readFile(join(projectRoot, 'zhin.config.yml'), 'utf8');
    expect(saved).toContain('port: 8086');

    const stale = await request({
      type: 'config:replace-source',
      requestId: 4,
      source: 'configVersion: 2\nplugins: {}\nhttp:\n  port: 9090\n',
      expectedRevision,
    });
    expect(stale.status).toBe(400);
  });

  it('rejects config:set with __proto__ as pluginName (400)', async () => {
    const { port } = await startHost({ projectRoot });
    const res = await fetch(`http://127.0.0.1:${port}/api/console/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'config:set',
        requestId: 2,
        pluginName: '__proto__',
        data: { polluted: true },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.error).toContain('Unknown configuration key');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('serves config:get-all from the on-disk file so it stays consistent with config:set', async () => {
    // 磁盘文件是唯一数据源：即使 generation 内存快照不同，get-all 也读文件，
    // 且环境变量占位符原样保留。
    await writeFile(join(projectRoot, 'zhin.config.yml'), 'configVersion: 2\nplugins: {}\nhttp:\n  port: 1000\n  token: ${HTTP_TOKEN}\n');
    const { port } = await startHost({ projectRoot });
    const getAll = (requestId: number) => fetch(`http://127.0.0.1:${port}/api/console/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'config:get-all', requestId }),
    }).then((res) => res.json() as Promise<{ data: Record<string, unknown> }>);

    const before = await getAll(7);
    expect(before.data).toEqual({ http: { port: 1000, token: '${HTTP_TOKEN}' } });

    // config:set 写文件后 get-all 立即读回新值（不再停留在 generation 快照）。
    const set = await fetch(`http://127.0.0.1:${port}/api/console/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'config:set',
        requestId: 8,
        pluginName: 'http',
        data: { port: 9090 },
      }),
    });
    expect(set.status).toBe(200);
    const after = await getAll(9);
    expect(after.data).toEqual({ http: { port: 9090 } });
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
      endpoints: { list: () => [] },
      messageEvents: {
        subscribe(listener: (event: RuntimeMessageEvent) => void) {
          messageListener = listener;
          return () => { messageListener = undefined; };
        },
      },
    } as unknown as ImRuntime;
    const hub = createConsoleEventHub();
    const releaseMessageBinding = new ConsoleMessageBindings({ hub }).acquire(im);
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    registerConsoleRoutes({
      http: host,
      consoleRuntime: stubConsoleRuntime(),
      projectRoot,
      im,
      eventHub: hub,
      configuration: configurationFor(projectRoot),
    });
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
      conversation: {
        endpoint: { id: 'root\0zhin.adapter\0icqq', adapter: 'icqq' },
        kind: 'group',
        id: '42',
        threadId: 'thread-1',
      },
      sender: { id: 'alice' },
      contentPreview: 'hello console',
      messageId: 'msg-1',
      timestamp: 1_700_000_000_000,
    });

    const frames = await readUntil('event: message.receive');
    expect(frames).not.toContain('event: endpoint:message');
    expect(frames).toContain('"adapter":"icqq"');
    expect(frames).toContain('"endpointKey":"icqq"');
    expect(frames).not.toContain('"endpoint":"icqq"');
    expect(frames).toContain('"sender":{"id":"alice"}');
    expect(frames).toContain('"content":"hello console"');
    expect(frames).toContain('"direction":"inbound"');
    expect(frames).toContain('"threadId":"thread-1"');
    expect(frames).toContain('"conversation":');

    // 出站 → message.receive（direction: outbound）
    messageListener?.({
      direction: 'outbound',
      conversation: {
        endpoint: { id: 'root\0zhin.adapter\0icqq', adapter: 'icqq' },
        kind: 'group',
        id: '42',
      },
      requester: 'root' as RuntimeMessageEvent['requester'],
      contentPreview: 'reply text',
      rendering: { forms: ['text'], fallbacks: ['renderer_unavailable'] },
      timestamp: 1_700_000_000_001,
    });
    const outbound = await readUntil('"direction":"outbound"');
    expect(outbound).toContain('"content":"reply text"');
    expect(outbound).toContain('"rendering":{"forms":["text"],"fallbacks":["renderer_unavailable"]}');

    const historyResponse = await fetch(`http://127.0.0.1:${port}/api/events/history?after=0&limit=10`);
    expect(historyResponse.status).toBe(200);
    const history = await historyResponse.json() as {
      success: boolean;
      data: { runtimeId: string; latestEventId: number; items: Array<Record<string, unknown>> };
    };
    expect(history.success).toBe(true);
    expect(history.data.runtimeId).toBe(hub.runtimeId);
    expect(history.data.latestEventId).toBe(2);
    expect(history.data.items).toEqual([
      expect.objectContaining({ eventId: 1, type: 'message.receive' }),
      expect.objectContaining({ eventId: 2, type: 'message.receive' }),
    ]);

    reader.cancel().catch(() => undefined);
    releaseMessageBinding();
  });

  it('publishes config:updated over SSE after config:set RPC', async () => {
    const hub = createConsoleEventHub();
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    registerConsoleRoutes({
      http: host,
      consoleRuntime: stubConsoleRuntime(),
      projectRoot,
      eventHub: hub,
      configuration: configurationFor(projectRoot),
    });
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
