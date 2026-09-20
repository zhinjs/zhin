import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { createConfigDocument } from '@zhin.js/config-file';
import { createHttpHost, createConsoleEventHub, type HttpHost } from '@zhin.js/host-http';
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
import { registerConsoleRoutes } from '../../../src/plugin-runtime/console/api-routes.js';
import { ConsoleConfigurationStore } from '../../../src/plugin-runtime/console/configuration.js';
import { isKnownConversationSession } from '../../../src/plugin-runtime/console/conversation-session.js';
import { ConsoleMessageBindings } from '../../../src/plugin-runtime/console/message-bindings.js';
import {
  resolveGenerationAgentConsole,
  resolveGenerationAgentIntrospection,
} from '../../../src/plugin-runtime/console/agent-console.js';
import {
  buildConsoleEntriesBody,
} from '../../../src/plugin-runtime/console/entry-projection.js';
import { displayConsolePath } from '../../../src/plugin-runtime/console/display-path.js';
import {
  buildPluginDetail,
  buildPluginFeatures,
  buildPluginListItem,
  listSnapshotPlugins,
} from '../../../src/plugin-runtime/console/plugin-projection.js';
import {
  buildConsoleStats,
  getSystemStatusData,
} from '../../../src/plugin-runtime/console/system-projection.js';

const hosts: HttpHost[] = [];
const tempRoots: string[] = [];

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
    source: join(packageRoot, 'commands/$ping.ts'),
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
  const host = createHttpHost({
    host: '127.0.0.1',
    port: 0,
    ...(options.withTokens
      ? { token: 'full-token', tokens: [
          { token: 'demo-token', scope: 'demo' as const },
          { token: 'sponsor-token', scope: 'full' as const, principalId: 'human:alice' },
          { token: 'other-token', scope: 'full' as const, principalId: 'human:bob' },
        ] }
      : {}),
  });
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
      `${projectRoot}/plugins/hello/commands/$ping.ts`,
      projectRoot,
    )).toBe('./plugins/hello/commands/$ping.ts');
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
    const token = { id: tokenId('zhin.host.agent') };
    const consolePort = {
      sessionTree: {},
      workroom: {},
      assistant: null,
      trace: {},
    };
    const snapshot = {
      root,
      resources: new Map([[root, new Map([[token.id, { console: consolePort }]])]]),
    } as unknown as RuntimeSnapshot;

    expect(resolveGenerationAgentConsole(snapshot, token)).toBe(consolePort);
  });
});

describe('console REST routes', () => {
  let projectRoot: string;
  let packageRoot: string;

  beforeEach(async () => {
    packageRoot = await makePackageRoot();
    projectRoot = tempRoots[tempRoots.length - 1];
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
      resources: new Map([[root, new Map([[tokenId('zhin.host.agent'), {
        console: {
          sessionTree: {},
          workroom: {},
          assistant: null,
          trace: { list: () => traceSnapshot },
        },
      }]])]]),
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
      { headers: { authorization: 'Bearer demo-token' } },
    );
    expect(demoResponse.status).toBe(401);
  });

  it('binds Workroom run reads to a full-scope token principal and never accepts caller identity', async () => {
    await import('@zhin.js/agent/runtime');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const root = rootPluginId();
    const safeRun = {
      version: 1, projectId: 'engineering', runId: 'run-1', status: 'active', sequence: 4,
      cancelRequested: false,
      counts: { tasks: 1, assignments: 1, reviewerAssignments: 0, sponsorGates: 0 },
      authorityDigest: 'sha256:authority', digest: 'sha256:run',
    };
    const listRuns = vi.fn(async (input: { projectId: string }) => input.projectId === 'engineering'
      ? { status: 'ready' as const, runs: [safeRun] }
      : { status: 'forbidden' as const });
    const getRun = vi.fn(async (input: { projectId: string; runId: string }) =>
      input.projectId === 'engineering' && input.runId === 'run-1'
        ? { status: 'ready' as const, run: { ...safeRun, tasks: [], assignments: [] } }
        : { status: 'forbidden' as const });
    const getReadiness = vi.fn(async (input: { projectId: string; runId: string }) =>
      input.projectId === 'engineering' && input.runId === 'run-1'
        ? { status: 'ready' as const, readiness: {
            version: 1, projectId: 'engineering', runId: 'run-1', sequence: 4,
            state: 'ready', blockers: [], recommendedActions: [],
            authorityDigest: 'sha256:authority', digest: 'sha256:readiness',
          } }
        : { status: 'forbidden' as const });
    const executeControl = vi.fn(async (command, principal) => ({
      status: 'committed' as const,
      action: command.action,
      operationId: command.operationId,
      receiptRef: 'event-control-1',
      receiptDigest: 'sha256:control',
      state: {
        projectId: command.projectId, runId: command.runId, status: 'needs_replan', sequence: 6,
        title: 'must-not-leak', now: 100, cancelRequested: false, replanRequested: true,
        tasks: {}, assignments: {}, reviewerAssignments: {}, sponsorGates: {},
      },
      principal,
    }));
    const snapshot = {
      root,
      resources: new Map([[root, new Map([[tokenId('zhin.host.agent'), {
        console: {
          sessionTree: {}, workroom: { listRuns, getRun, getReadiness },
          workroomControl: { execute: executeControl }, assistant: null,
          trace: { list: () => ({ sessionKey: '', events: [], latestSequence: 0, activeTurnIds: [] }) },
        },
      }]])]]),
    } as unknown as RuntimeSnapshot;
    const snapshots = {
      acquire: () => ({ value: snapshot, active: true, release: () => undefined }),
    } as unknown as SnapshotReader;
    const { port } = await startHost({ projectRoot, withTokens: true, snapshots });

    const authorized = await fetch(
      `http://127.0.0.1:${port}/api/agent/workroom/runs?projectId=engineering`,
      { headers: { authorization: 'Bearer sponsor-token' } },
    );
    expect(authorized.status).toBe(200);
    expect(listRuns).toHaveBeenCalledWith({
      projectId: 'engineering', authenticatedPrincipal: { principalId: 'human:alice' },
    });
    const encoded = JSON.stringify(await authorized.json());
    expect(encoded).not.toMatch(/title|plan|reason|progress|objective/u);

    const unbound = await fetch(
      `http://127.0.0.1:${port}/api/agent/workroom/runs?projectId=engineering`,
      { headers: { authorization: 'Bearer full-token' } },
    );
    expect(unbound.status).toBe(403);
    const crossProject = await fetch(
      `http://127.0.0.1:${port}/api/agent/workroom/runs?projectId=finance`,
      { headers: { authorization: 'Bearer sponsor-token' } },
    );
    expect(crossProject.status).toBe(403);
    const forged = await fetch(
      `http://127.0.0.1:${port}/api/agent/workroom/runs?projectId=engineering&principalId=human%3Amallory`,
      { headers: { authorization: 'Bearer sponsor-token' } },
    );
    expect(forged.status).toBe(400);
    expect(listRuns).toHaveBeenCalledTimes(2);

    const detail = await fetch(
      `http://127.0.0.1:${port}/api/agent/workroom/runs/run-1?projectId=engineering`,
      { headers: { authorization: 'Bearer sponsor-token' } },
    );
    expect(detail.status).toBe(200);
    expect(getRun).toHaveBeenCalledWith({
      projectId: 'engineering', runId: 'run-1',
      authenticatedPrincipal: { principalId: 'human:alice' },
    });

    const readiness = await fetch(
      `http://127.0.0.1:${port}/api/agent/workroom/readiness?projectId=engineering&runId=run-1`,
      { headers: { authorization: 'Bearer sponsor-token' } },
    );
    expect(readiness.status).toBe(200);
    expect(await readiness.json()).toMatchObject({
      success: true, data: { projectId: 'engineering', runId: 'run-1', state: 'ready' },
    });
    expect(getReadiness).toHaveBeenCalledWith({
      projectId: 'engineering', runId: 'run-1',
      authenticatedPrincipal: { principalId: 'human:alice' },
    });

    const control = await fetch(
      `http://127.0.0.1:${port}/api/agent/workroom/control`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer sponsor-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          version: 1, operationId: 'replan-1', projectId: 'engineering', runId: 'run-1',
          expectedSequence: 4, action: 'request_replan', reasonCode: 'requirements_changed',
        }),
      },
    );
    expect(control.status).toBe(200);
    const controlBody = await control.json();
    expect(controlBody).toMatchObject({
      success: true,
      data: {
        status: 'committed', action: 'request_replan', operationId: 'replan-1',
        run: { projectId: 'engineering', runId: 'run-1', status: 'needs_replan', sequence: 6 },
      },
    });
    expect(JSON.stringify(controlBody)).not.toContain('must-not-leak');
    expect(executeControl).toHaveBeenCalledWith(expect.objectContaining({
      action: 'request_replan', expectedSequence: 4,
    }), { principalId: 'human:alice' });

    const forgedControl = await fetch(
      `http://127.0.0.1:${port}/api/agent/workroom/control`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer sponsor-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          version: 1, operationId: 'cancel-1', projectId: 'engineering', runId: 'run-1',
          expectedSequence: 4, action: 'cancel', reasonCode: 'operator_request',
          controlDeadline: 120, principalId: 'human:mallory',
        }),
      },
    );
    expect(forgedControl.status).toBe(400);
  });

  it('cancels an active Agent task through the generation-owned console port', async () => {
    await import('@zhin.js/agent/runtime');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const root = rootPluginId();
    const cancelSession = vi.fn(() => true);
    const snapshot = {
      root,
      resources: new Map([[root, new Map([[tokenId('zhin.host.agent'), {
        console: {
          sessionTree: {}, workroom: {}, assistant: null,
          trace: { list: () => ({ sessionKey: '', events: [], latestSequence: 0, activeTurnIds: [] }) },
          cancelSession,
        },
      }]])]]),
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

  it('routes authenticated Workroom Profile writes through the generation-owned narrow port', async () => {
    await import('@zhin.js/agent/runtime');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const root = rootPluginId();
    const publishPack = vi.fn(async (command) => ({ pack: command.pack }));
    const getPlanningStatus = vi.fn(async (_projectId, principal) => ({
      projectId: 'engineering', principalId: principal?.principalId, ready: false,
    }));
    const bootstrapPlanning = vi.fn(async command => ({ projectId: command.projectId, ready: true }));
    const publishKnowledge = vi.fn(async () => ({ projectId: 'engineering', revision: 0 }));
    const snapshot = {
      root,
      resources: new Map([[root, new Map([[tokenId('zhin.host.agent'), {
        console: {
          sessionTree: {}, workroom: {}, assistant: null,
          trace: { list: () => ({ sessionKey: '', events: [], latestSequence: 0, activeTurnIds: [] }) },
          workroomProfiles: {
            getPlanningStatus,
            bootstrapPlanning,
            publishPack,
            publishProfile: vi.fn(),
            publishRollback: vi.fn(),
            publishPlanningPolicy: vi.fn(),
          },
          workroomKnowledge: {
            read: vi.fn(), publish: publishKnowledge, rollback: vi.fn(),
          },
        },
      }]])]]),
    } as unknown as RuntimeSnapshot;
    const snapshots = {
      acquire: () => ({ value: snapshot, active: true, release: () => undefined }),
    } as unknown as SnapshotReader;
    const { port } = await startHost({ projectRoot, withTokens: true, snapshots });
    const response = await fetch(`http://127.0.0.1:${port}/api/console/request`, {
      method: 'POST',
      headers: { authorization: 'Bearer sponsor-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'workroom.profile.pack.publish', requestId: 21,
        operationId: 'console:pack:21', pack: { id: 'pack:engineering' },
      }),
    });
    expect(response.status).toBe(200);
    expect(publishPack).toHaveBeenCalledWith({
      operationId: 'console:pack:21', pack: { id: 'pack:engineering' },
    }, { principalId: 'human:alice' });

    const demo = await fetch(`http://127.0.0.1:${port}/api/console/request`, {
      method: 'POST',
      headers: { authorization: 'Bearer demo-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'workroom.profile.pack.publish', requestId: 22,
        operationId: 'console:pack:22', pack: { id: 'pack:engineering' },
      }),
    });
    expect(demo.status).toBe(400);
    expect(publishPack).toHaveBeenCalledTimes(1);

    const status = await fetch(`http://127.0.0.1:${port}/api/console/request`, {
      method: 'POST',
      headers: { authorization: 'Bearer sponsor-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'workroom.profile.status', requestId: 25, projectId: 'engineering',
      }),
    });
    expect(status.status).toBe(200);
    expect(getPlanningStatus).toHaveBeenCalledWith('engineering', { principalId: 'human:alice' });

    const bootstrap = await fetch(`http://127.0.0.1:${port}/api/console/request`, {
      method: 'POST',
      headers: { authorization: 'Bearer sponsor-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'workroom.profile.bootstrap', requestId: 26,
        operationId: 'console:bootstrap:26', projectId: 'engineering', expectedRegistryRevision: -1,
      }),
    });
    expect(bootstrap.status).toBe(200);
    expect(bootstrapPlanning).toHaveBeenCalledWith({
      operationId: 'console:bootstrap:26', projectId: 'engineering', expectedRegistryRevision: -1,
    }, { principalId: 'human:alice' });

    const knowledge = await fetch(`http://127.0.0.1:${port}/api/console/request`, {
      method: 'POST',
      headers: { authorization: 'Bearer sponsor-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'workroom.knowledge.publish', requestId: 23,
        operationId: 'console:knowledge:23', projectId: 'engineering', expectedRevision: -1,
        entries: [],
      }),
    });
    expect(knowledge.status).toBe(200);
    expect(publishKnowledge).toHaveBeenCalledWith({
      operationId: 'console:knowledge:23', projectId: 'engineering', expectedRevision: -1, entries: [],
    }, { principalId: 'human:alice' });
    const forgedBody = await fetch(`http://127.0.0.1:${port}/api/console/request`, {
      method: 'POST',
      headers: { authorization: 'Bearer sponsor-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'workroom.knowledge.publish', requestId: 24,
        operationId: 'console:knowledge:24', projectId: 'engineering', expectedRevision: -1,
        entries: [], body: 'must-not-enter-control-plane',
      }),
    });
    expect(forgedBody.status).toBe(400);
    expect(publishKnowledge).toHaveBeenCalledTimes(1);
  });

  it('exposes the authenticated principal through the Workroom Catalog read contract', async () => {
    await import('@zhin.js/agent/runtime');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const root = rootPluginId();
    const readCatalog = vi.fn(async () => ({
      revision: 'a'.repeat(64),
      definitions: {},
    }));
    const snapshot = {
      root,
      resources: new Map([[root, new Map([[tokenId('zhin.host.agent'), {
        console: {
          sessionTree: {}, workroom: {}, assistant: null,
          trace: { list: () => ({ sessionKey: '', events: [], latestSequence: 0, activeTurnIds: [] }) },
          workroomCatalog: { read: readCatalog },
          listBindings: () => [],
        },
      }]])]]),
    } as unknown as RuntimeSnapshot;
    const release = vi.fn();
    const snapshots = {
      acquire: () => ({ value: snapshot, active: true, release }),
    } as unknown as SnapshotReader;
    const { port } = await startHost({ projectRoot, withTokens: true, snapshots });

    const sponsor = await fetch(`http://127.0.0.1:${port}/api/console/request`, {
      method: 'POST',
      headers: { authorization: 'Bearer sponsor-token', 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'workrooms:get', requestId: 31 }),
    });
    await expect(sponsor.json()).resolves.toMatchObject({
      success: true,
      data: { principalId: 'human:alice', workrooms: {}, revision: 'a'.repeat(64) },
    });

    const unbound = await fetch(`http://127.0.0.1:${port}/api/console/request`, {
      method: 'POST',
      headers: { authorization: 'Bearer full-token', 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'workrooms:get', requestId: 32, principalId: 'human:mallory' }),
    });
    const unboundBody = await unbound.json() as { data?: { principalId?: string } };
    expect(unboundBody.data?.principalId).toBeUndefined();
    expect(readCatalog).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('keeps Sponsor controls typed and injects the token principal without accepting forged identity', async () => {
    await import('@zhin.js/agent/runtime');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const root = rootPluginId();
    const projection = { version: 1, portfolioId: 'portfolio-main', sourceSequence: 4,
      clock: { now: 10, sequence: 4, digest: 'sha256:a' }, projects: {} };
    let sponsorAuthorized = true;
    const read = vi.fn(async (
      _portfolioId: string,
      principal: Readonly<{ principalId: string }>,
    ) => sponsorAuthorized && principal.principalId === 'human:alice'
      ? { status: 'ready' as const, projection }
      : { status: 'forbidden' as const });
    const execute = vi.fn(async () => projection);
    const decideEffect = vi.fn(async command => ({ ...command, principalId: 'human:alice', digest: 'sha256:decision' }));
    const snapshot = {
      root,
      resources: new Map([[root, new Map([[tokenId('zhin.host.agent'), {
        console: {
          sessionTree: {}, workroom: {}, assistant: null,
          trace: { list: () => ({ sessionKey: '', events: [], latestSequence: 0, activeTurnIds: [] }) },
          portfolioSponsor: { read, execute },
          effectSponsor: { decide: decideEffect },
        },
      }]])]]),
    } as unknown as RuntimeSnapshot;
    const snapshots = {
      acquire: () => ({ value: snapshot, active: true, release: () => undefined }),
    } as unknown as SnapshotReader;
    const { port } = await startHost({ projectRoot, withTokens: true, snapshots });

    const demoRead = await fetch(
      `http://127.0.0.1:${port}/api/agent/workroom/portfolio?portfolioId=portfolio-main`,
      { headers: { authorization: 'Bearer demo-token' } },
    );
    expect(demoRead.status).toBe(401);

    const unboundRead = await fetch(
      `http://127.0.0.1:${port}/api/agent/workroom/portfolio?portfolioId=portfolio-main`,
      { headers: { authorization: 'Bearer full-token' } },
    );
    expect(unboundRead.status).toBe(403);

    const nonSponsorRead = await fetch(
      `http://127.0.0.1:${port}/api/agent/workroom/portfolio?portfolioId=portfolio-main`,
      { headers: { authorization: 'Bearer other-token' } },
    );
    expect(nonSponsorRead.status).toBe(403);

    const readResponse = await fetch(
      `http://127.0.0.1:${port}/api/agent/workroom/portfolio?portfolioId=portfolio-main`,
      { headers: { authorization: 'Bearer sponsor-token' } },
    );
    expect(readResponse.status).toBe(200);
    expect(JSON.stringify(await readResponse.json())).not.toContain('objective');
    expect(read).toHaveBeenLastCalledWith('portfolio-main', { principalId: 'human:alice' });

    sponsorAuthorized = false;
    const revokedRead = await fetch(
      `http://127.0.0.1:${port}/api/agent/workroom/portfolio?portfolioId=portfolio-main`,
      { headers: { authorization: 'Bearer sponsor-token' } },
    );
    expect(revokedRead.status).toBe(403);

    const command = { kind: 'set_status', commandId: 'pause:1', projectId: 'alpha',
      expectedProjectRevision: 1, status: 'paused' };
    const commandResponse = await fetch(`http://127.0.0.1:${port}/api/agent/workroom/portfolio/commands`, {
      method: 'POST',
      headers: { authorization: 'Bearer sponsor-token', 'content-type': 'application/json' },
      body: JSON.stringify({ portfolioId: 'portfolio-main', command }),
    });
    expect(commandResponse.status).toBe(200);
    expect(execute).toHaveBeenCalledWith('portfolio-main', command, { principalId: 'human:alice' });

    const unbound = await fetch(`http://127.0.0.1:${port}/api/agent/workroom/portfolio/commands`, {
      method: 'POST',
      headers: { authorization: 'Bearer full-token', 'content-type': 'application/json' },
      body: JSON.stringify({ portfolioId: 'portfolio-main', command }),
    });
    expect(unbound.status).toBe(403);
    const forged = await fetch(`http://127.0.0.1:${port}/api/agent/workroom/portfolio/commands`, {
      method: 'POST',
      headers: { authorization: 'Bearer sponsor-token', 'content-type': 'application/json' },
      body: JSON.stringify({ portfolioId: 'portfolio-main', command, principalId: 'human:mallory' }),
    });
    expect(forged.status).toBe(400);
    expect(execute).toHaveBeenCalledTimes(1);

    const effectCommand = {
      version: 2, operationId: 'effect-decision:1', projectId: 'alpha', runId: 'run-1',
      effectIntentId: 'effect:1', effectIntentDigest: 'sha256:intent',
      decision: 'approve', reasonCode: 'approved_as_requested', decidedAt: 10,
    };
    const effectResponse = await fetch(
      `http://127.0.0.1:${port}/api/agent/workroom/effects/sponsor-decisions`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer sponsor-token', 'content-type': 'application/json' },
        body: JSON.stringify(effectCommand),
      },
    );
    expect(effectResponse.status).toBe(200);
    expect(decideEffect).toHaveBeenCalledWith(effectCommand, { principalId: 'human:alice' });
    const legacyEffect = await fetch(
      `http://127.0.0.1:${port}/api/agent/workroom/effects/sponsor-decisions`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer sponsor-token', 'content-type': 'application/json' },
        body: JSON.stringify({ ...effectCommand, version: 1, reason: 'free-form rationale' }),
      },
    );
    expect(legacyEffect.status).toBe(400);
    const forgedEffect = await fetch(
      `http://127.0.0.1:${port}/api/agent/workroom/effects/sponsor-decisions`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer sponsor-token', 'content-type': 'application/json' },
        body: JSON.stringify({ ...effectCommand, principalId: 'human:mallory' }),
      },
    );
    expect(forgedEffect.status).toBe(400);
    expect(decideEffect).toHaveBeenCalledTimes(1);
  });

  it('exposes only token-bound typed Data Lifecycle controls and content-free projections', async () => {
    await import('@zhin.js/agent/runtime');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const root = rootPluginId();
    const projection = { version: 1, projectId: 'alpha', objectId: 'object-1', sequence: 3,
      stateDigest: 'sha256:state', authorityDigest: 'sha256:authority', holds: [], erasures: [], purges: [],
      cryptoErased: false, purgeComplete: false, digest: 'sha256:projection' };
    const read = vi.fn(async (_input, principal: Readonly<{ principalId: string }>) =>
      principal.principalId === 'human:alice'
        ? { status: 'ready' as const, projection }
        : { status: 'forbidden' as const });
    const listOverdue = vi.fn(async () => ({ status: 'ready' as const, items: [] }));
    const execute = vi.fn(async (command: { operationId?: string }, principal: Readonly<{ principalId: string }>) => {
      if (principal.principalId !== 'human:alice') return { status: 'forbidden' as const };
      if (command.operationId === 'export:stale') {
        return { status: 'stale' as const, candidateDigest: 'sha256:candidate' };
      }
      if (command.operationId === 'export:no-audit') {
        return { status: 'unavailable' as const, reason: 'subject_export_audit' as const };
      }
      return { status: 'ready' as const, projection };
    });
    const snapshot = {
      root,
      resources: new Map([[root, new Map([[tokenId('zhin.host.agent'), {
        console: {
          sessionTree: {}, workroom: {}, assistant: null,
          trace: { list: () => ({ sessionKey: '', events: [], latestSequence: 0, activeTurnIds: [] }) },
          dataLifecycle: { read, listOverdue, execute },
        },
      }]])]]),
    } as unknown as RuntimeSnapshot;
    const snapshots = {
      acquire: () => ({ value: snapshot, active: true, release: () => undefined }),
    } as unknown as SnapshotReader;
    const { port } = await startHost({ projectRoot, withTokens: true, snapshots });

    const demo = await fetch(`http://127.0.0.1:${port}/api/agent/workroom/data-lifecycle?projectId=alpha&objectId=object-1`, {
      headers: { authorization: 'Bearer demo-token' },
    });
    expect(demo.status).toBe(401);
    const unbound = await fetch(`http://127.0.0.1:${port}/api/agent/workroom/data-lifecycle?projectId=alpha&objectId=object-1`, {
      headers: { authorization: 'Bearer full-token' },
    });
    expect(unbound.status).toBe(403);
    const denied = await fetch(`http://127.0.0.1:${port}/api/agent/workroom/data-lifecycle?projectId=alpha&objectId=object-1`, {
      headers: { authorization: 'Bearer other-token' },
    });
    expect(denied.status).toBe(403);
    const ready = await fetch(`http://127.0.0.1:${port}/api/agent/workroom/data-lifecycle?projectId=alpha&objectId=object-1`, {
      headers: { authorization: 'Bearer sponsor-token' },
    });
    expect(ready.status).toBe(200);
    expect(JSON.stringify(await ready.json())).not.toMatch(/principal|decision|payload|content/iu);
    expect(read).toHaveBeenCalledWith(
      { projectId: 'alpha', objectId: 'object-1' }, { principalId: 'human:alice' },
    );

    const overdue = await fetch(`http://127.0.0.1:${port}/api/agent/workroom/data-lifecycle/overdue?operationId=overdue%3A1&projectId=alpha`, {
      headers: { authorization: 'Bearer sponsor-token' },
    });
    expect(overdue.status).toBe(200);
    expect(listOverdue).toHaveBeenCalledWith(
      { operationId: 'overdue:1', projectId: 'alpha' }, { principalId: 'human:alice' },
    );

    const command = { kind: 'place_hold', operationId: 'hold:1', projectId: 'alpha', objectId: 'object-1',
      holdId: 'hold-1', reasonCode: 'legal_hold', reviewAt: 20 };
    const commandResponse = await fetch(`http://127.0.0.1:${port}/api/agent/workroom/data-lifecycle/commands`, {
      method: 'POST', headers: { authorization: 'Bearer sponsor-token', 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    expect(commandResponse.status).toBe(200);
    expect(execute).toHaveBeenCalledWith(command, { principalId: 'human:alice' }, expect.any(AbortSignal));

    const exportCommand = { kind: 'export_subject', operationId: 'export:stale', tenantId: 'tenant-1',
      projectId: 'alpha', subjectRef: 'subject@example.test', deadline: 20 };
    const staleExport = await fetch(`http://127.0.0.1:${port}/api/agent/workroom/data-lifecycle/commands`, {
      method: 'POST', headers: { authorization: 'Bearer sponsor-token', 'content-type': 'application/json' },
      body: JSON.stringify(exportCommand),
    });
    expect(staleExport.status).toBe(409);
    expect(JSON.stringify(await staleExport.json())).not.toContain('subject@example.test');

    const unavailableExport = await fetch(`http://127.0.0.1:${port}/api/agent/workroom/data-lifecycle/commands`, {
      method: 'POST', headers: { authorization: 'Bearer sponsor-token', 'content-type': 'application/json' },
      body: JSON.stringify({ ...exportCommand, operationId: 'export:no-audit' }),
    });
    expect(unavailableExport.status).toBe(503);

    const forged = await fetch(`http://127.0.0.1:${port}/api/agent/workroom/data-lifecycle/commands`, {
      method: 'POST', headers: { authorization: 'Bearer sponsor-token', 'content-type': 'application/json' },
      body: JSON.stringify({ ...command, role: 'data_steward', decisionProof: 'forged', content: 'secret' }),
    });
    expect(forged.status).toBe(400);
    expect(execute).toHaveBeenCalledTimes(3);
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
      name: 'proj',
      zhin: {
        plugins: [{
          package: '@zhin.js/adapter-icqq',
          instanceKey: 'icqq',
          enabled: false,
        }],
      },
    }));
    const packageDir = join(projectRoot, 'node_modules', '@zhin.js', 'adapter-icqq');
    await mkdir(packageDir, { recursive: true });
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({
      name: '@zhin.js/adapter-icqq',
      version: '1.2.0',
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
    });
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
    expect(existsSync(join(projectRoot, 'zhin.config.yml'))).toBe(false);

    const good = await request({
      type: 'config:replace-source',
      requestId: 3,
      source: 'http:\n  port: 8086\n',
      expectedRevision,
    });
    expect(good.status).toBe(200);
    const saved = await readFile(join(projectRoot, 'zhin.config.yml'), 'utf8');
    expect(saved).toContain('port: 8086');

    const stale = await request({
      type: 'config:replace-source',
      requestId: 4,
      source: 'http:\n  port: 9090\n',
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
    expect(body.error).toContain('Invalid config key');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('serves config:get-all from the on-disk file so it stays consistent with config:set', async () => {
    // 磁盘文件是唯一数据源：即使 generation 内存快照不同，get-all 也读文件，
    // 且环境变量占位符原样保留。
    await writeFile(join(projectRoot, 'zhin.config.yml'), 'http:\n  port: 1000\n  token: ${HTTP_TOKEN}\n');
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
        endpoint: { id: 'root\0zhin.adapter\0icqq', adapter: 'root' },
        kind: 'group',
        id: '42',
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

    // 出站 → message.receive（direction: outbound）
    messageListener?.({
      direction: 'outbound',
      conversation: {
        endpoint: { id: 'root\0zhin.adapter\0icqq', adapter: 'root' },
        kind: 'group',
        id: '42',
      },
      requester: 'root' as RuntimeMessageEvent['requester'],
      contentPreview: 'reply text',
      timestamp: 1_700_000_000_001,
    });
    const outbound = await readUntil('"direction":"outbound"');
    expect(outbound).toContain('"content":"reply text"');

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
