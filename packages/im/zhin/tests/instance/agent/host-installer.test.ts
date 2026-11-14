import { agentHostToken } from '@zhin.js/agent/runtime';
import { ingressRouteToken } from '@zhin.js/core/runtime';
import {
  Scope,
  SnapshotStore,
  rootPluginId,
  definePlugin,
  createPluginEventChannel,
} from '@zhin.js/plugin-runtime';
import { RootRuntime } from '@zhin.js/runtime';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostToolApprovalConsoleRpc } from '../../../src/instance/console/tool-approvals.js';
import { dispatchPluginConsoleRpcRequest } from '../../../src/instance/console/plugin-console-rpc.js';
import { agentToolApprovalQueueToken } from '../../../src/instance/console/tool-approvals.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseHost } from '@zhin.js/core/runtime';
import { HostInference } from '@zhin.js/agent/runtime';
import { publishAgentToolFeatures } from '@zhin.js/agent/runtime';
import type { ModelRuntimeServiceOptions } from '@zhin.js/agent/model-runtime';

// Holds the next candidate Foundation composition so a test can observe the live Host mid-reload.
const candidateGate: { current?: () => Promise<void> } = {};
const publishHost = vi.hoisted(() => vi.fn());
// Real ZhinAgent so the test exercises its actual SessionSystem persistence latch.
const agentRef: { current?: InstanceType<typeof import('@zhin.js/agent/runtime').ZhinAgent> } = {};

vi.mock('@zhin.js/agent/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zhin.js/agent/runtime')>();
  return {
    ...actual,
    AgentRuntimeFoundation: {
      create: vi.fn(async (options: { modelRuntime: ModelRuntimeServiceOptions }) => {
        const gate = candidateGate.current;
        candidateGate.current = undefined;
        await gate?.();
        const { AIService } = await import('@zhin.js/agent');
        const service = new AIService({ agents: { zhin: {} } });
        await service.prepareModelRuntime(options.modelRuntime);
        return {
          service,
          agent: agentRef.current,
          knowledgeIndex: undefined,
          semanticMemory: null,
          scheduleTools: [],
          schedule: { start: vi.fn() },
          homeTools: [],
          assistantEnabled: false,
          listBindings: () => [],
        };
      }),
    },
    publishAgentToolFeatures: vi.fn(),
    AgentHostPublicationCoordinator: class {
      constructor(options: { resources: Scope }) {
        publishHost(options);
        options.resources.provide(actual.agentHostToken, {} as never);
      }
    },
  };
});

const { installAgentHost } = await import('../../../src/instance/agent/host-installer.js');
const { ZhinAgent } = await import('@zhin.js/agent/runtime');
let defaultProjectRoot: string;
let database: ReturnType<typeof createDatabaseHost>;
const inferenceHosts = new Map<string, { host: HostInference; snapshots: SnapshotStore }>();
function inferenceFor(projectRoot: string) {
  const existing = inferenceHosts.get(projectRoot);
  if (existing) return existing.host;
  const root = rootPluginId();
  const snapshots = new SnapshotStore({
    root,
    tree: new Map([
      [
        root,
        {
          id: root,
          instanceKey: 'root',
          packageName: 'host-installer-fixture',
          packageRoot: projectRoot,
          children: [],
        },
      ],
    ]),
    config: new Map(),
    resources: new Map(),
    capabilities: new Map(),
    projections: new Map(),
  });
  const host = new HostInference({
    projectRoot,
    database,
    snapshots: () => snapshots,
    resolveSource: () => {
      throw new Error('Lifecycle fixture never resolves credentials');
    },
    personalOwners: [],
  });
  inferenceHosts.set(projectRoot, { host, snapshots });
  return host;
}
const disposers: Array<() => void | Promise<void>> = [];

function context(resources: Scope, events = createPluginEventChannel().events) {
  return {
    generation: 1,
    events,
    signal: new AbortController().signal,
    resources,
    lifecycle: {
      add: vi.fn((dispose: () => void | Promise<void>) => {
        disposers.push(dispose);
      }),
    },
    handoff: { add: vi.fn() },
    config: {
      get: (key: string) => (key === 'ai' ? { enabled: true, sessions: { useDatabase: false } } : undefined),
    },
    addFeature: vi.fn(),
  } as never;
}

function install() {
  return installAgentHost({
    runtime: {} as never,
    im: {} as never,
    projectRoot: defaultProjectRoot,
    inference: inferenceFor(defaultProjectRoot),
  });
}

describe('installAgentHost', () => {
  beforeEach(async () => {
    defaultProjectRoot = await mkdtemp(join(tmpdir(), 'zhin-agent-installer-'));
    database = createDatabaseHost({ dialect: 'sqlite', filename: ':memory:' });
    inferenceFor(defaultProjectRoot);
    await database.start();
    candidateGate.current = undefined;
    publishHost.mockClear();
    // Offline provider: never called, the installer only composes the Agent.
    agentRef.current = new ZhinAgent({ config: { sessions: { useDatabase: false } } });
  });
  afterEach(async () => {
    vi.useRealTimers();
    for (const dispose of disposers.splice(0).reverse()) await dispose();
    await agentRef.current?.dispose();
    for (const { host, snapshots } of inferenceHosts.values()) {
      await host.close();
      await snapshots.close();
    }
    inferenceHosts.clear();
    await database.stop();
    await rm(defaultProjectRoot, { recursive: true, force: true });
  });

  it('starts the Agent and publishes agentHostToken and ingressRouteToken', async () => {
    const resources = new Scope(rootPluginId());
    await install()(context(resources));

    expect(resources.has(agentHostToken)).toBe(true);
    expect(resources.has(ingressRouteToken)).toBe(true);
  });

  it('captures each real bootstrap source before formatting its headings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-bootstrap-files-'));
    try {
      const agents = '# Rules\n## SOUL.md\nKeep these release instructions.';
      await writeFile(join(root, 'SOUL.md'), 'Main persona.');
      await writeFile(join(root, 'AGENTS.md'), agents);
      await installAgentHost({
        runtime: {} as never,
        im: {} as never,
        projectRoot: root,
        inference: inferenceFor(root),
      })(context(new Scope(rootPluginId())));
      expect(publishHost).toHaveBeenCalledWith(
        expect.objectContaining({
          bootstrapText: `## SOUL.md\nMain persona.\n\n## AGENTS.md\n${agents}`,
          contextFiles: [
            { path: 'SOUL.md', content: 'Main persona.' },
            { path: 'AGENTS.md', content: agents },
          ],
        })
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reads BOT.md instead of AGENTS.md and picks up an edit on the next Root generation (#1250)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-bootstrap-bot-'));
    const installAt = () => installAgentHost({
      runtime: {} as never,
      im: {} as never,
      projectRoot: root,
      inference: inferenceFor(root),
    })(context(new Scope(rootPluginId())));
    try {
      await writeFile(join(root, 'SOUL.md'), 'Main persona.');
      await writeFile(join(root, 'AGENTS.md'), 'Developer rules.');
      await writeFile(join(root, 'BOT.md'), 'Bot rules v1.');
      await installAt();
      expect(publishHost).toHaveBeenLastCalledWith(expect.objectContaining({
        bootstrapText: '## SOUL.md\nMain persona.\n\n## BOT.md\nBot rules v1.',
        contextFiles: [
          { path: 'SOUL.md', content: 'Main persona.' },
          { path: 'BOT.md', content: 'Bot rules v1.' },
        ],
      }));

      // A Root generation rebuild (what an edited root file triggers) re-runs the installer.
      await writeFile(join(root, 'BOT.md'), 'Bot rules v2.');
      await installAt();
      expect(publishHost).toHaveBeenLastCalledWith(expect.objectContaining({
        bootstrapText: '## SOUL.md\nMain persona.\n\n## BOT.md\nBot rules v2.',
      }));

      // Emptying BOT.md hands the slot back to AGENTS.md.
      await writeFile(join(root, 'BOT.md'), '  \n');
      await installAt();
      expect(publishHost).toHaveBeenLastCalledWith(expect.objectContaining({
        bootstrapText: '## SOUL.md\nMain persona.\n\n## AGENTS.md\nDeveloper rules.',
      }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('ignores a data/BOT.md: only the project-root BOT.md replaces AGENTS.md (#1250)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-bootstrap-data-bot-'));
    try {
      await mkdir(join(root, 'data'), { recursive: true });
      await writeFile(join(root, 'AGENTS.md'), 'Developer rules.');
      await writeFile(join(root, 'data', 'BOT.md'), 'Bot rules from data.');
      await installAgentHost({
        runtime: {} as never,
        im: {} as never,
        projectRoot: root,
        inference: inferenceFor(root),
      })(context(new Scope(rootPluginId())));
      expect(publishHost).toHaveBeenLastCalledWith(expect.objectContaining({
        bootstrapText: '## AGENTS.md\nDeveloper rules.',
        contextFiles: [{ path: 'AGENTS.md', content: 'Developer rules.' }],
      }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('marks Agent persistence ready so the first turn does not wait for the timeout (#857)', async () => {
    const resources = new Scope(rootPluginId());
    await install()(context(resources));

    // Before the fix nothing opened the latch: this wait only settled when the
    // SessionSystem fallback timer fired (5 s in production) and logged a warning.
    vi.useFakeTimers();
    let settled = false;
    void agentRef.current!.waitForMemoryPersistence().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps transient cards through rejected or reused Root outcomes and closes only its own committed replacement', async () => {
    const channel = createPluginEventChannel(),
      resources = new Scope(rootPluginId());
    await install()(context(resources, channel.events));
    const queue = agentRef.current!.toolApprovals;
    const card = queue.enqueue({
      toolName: 'group_kick',
      category: 'member',
      sessionKey: 'session',
      turnId: 'turn',
      args: {},
    });
    try {
      for (const [outcome, state] of [
        ['rejected', 'current'],
        ['cancelled', 'current'],
        ['unchanged', 'current'],
        ['committed', 'current'],
      ] as const) {
        await channel.dispatch('hmr.resume', {
          signal: new AbortController().signal,
          details: {
            trigger: 'source',
            changed: ['/fixture/other-slot.ts'],
            planned: { fullRoot: false, plugins: [], capabilities: [] },
            previousGeneration: 1,
            activeGeneration: 2,
            receiver: { owner: rootPluginId(), creationGeneration: 1, state },
            outcome,
            replaced: [],
          },
        });
        expect(queue.closed).toBe(false);
        expect(queue.get(card.id)?.status).toBe('pending');
      }
      await channel.dispatch('hmr.resume', {
        signal: new AbortController().signal,
        details: {
          trigger: 'manual',
          changed: [],
          planned: { fullRoot: true, plugins: [rootPluginId()], capabilities: [] },
          previousGeneration: 1,
          activeGeneration: 2,
          receiver: { owner: rootPluginId(), creationGeneration: 1, state: 'replaced' },
          outcome: 'committed',
          replaced: [rootPluginId()],
        },
      });
      expect(queue.closed).toBe(true);
      expect(queue.get(card.id)?.status).toBe('expired');
    } finally {
      queue.dispose();
      channel.dispose();
    }
  });

  it('keeps the committed approval queue visible while a real Root candidate is held and rejected', async () => {
    const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-approval-publication-')));
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({
        name: 'approval-fixture',
        zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
      })
    );
    await writeFile(join(project, 'plugin.ts'), '');
    const oldAgent = agentRef.current!;
    const candidateAgent = new ZhinAgent({ config: { sessions: { useDatabase: false } } });
    const replacementAgent = new ZhinAgent({ config: { sessions: { useDatabase: false } } });
    const runtime = new RootRuntime({
      projectRoot: project,
      config: { configVersion: 2, ai: { enabled: true, sessions: { useDatabase: false } } },
      environment: { name: 'test', mode: 'test', platform: 'node' },
      modules: {
        async load<T>() {
          return { default: definePlugin({ name: 'approval-fixture' }) } as T;
        },
        async close() {},
      },
      installResources: installAgentHost({
        runtime: {} as never,
        im: {} as never,
        projectRoot: project,
        inference: inferenceFor(project),
      }),
    });
    const call = (type = 'tool-approvals', data?: Record<string, string>) =>
      dispatchPluginConsoleRpcRequest(
        { type: `plugin.root.${type}`, ...(data ? { data } : {}) },
        {
          snapshots: runtime.snapshots,
          access: { unrestricted: true, permissions: [], roles: [] },
          hostRpc: (lease) => createHostToolApprovalConsoleRpc({ snapshots: runtime.snapshots, lease }),
        }
      );
    let release!: () => void, enter!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let reload: Promise<unknown> | undefined;
    try {
      await runtime.start();
      expect(runtime.snapshot.resources.get(rootPluginId())?.has(agentToolApprovalQueueToken.id)).toBe(false);
      const card = oldAgent.toolApprovals.enqueue({
        toolName: 'group_kick',
        category: 'member',
        sessionKey: 'session',
        turnId: 'turn',
        args: { target: 'member' },
      });
      expect(await call()).toMatchObject({ status: 200, body: { data: { pending: [{ id: card.id }] } } });
      agentRef.current = candidateAgent;
      candidateGate.current = async () => {
        enter();
        await held;
      };
      vi.mocked(publishAgentToolFeatures).mockImplementationOnce(() => {
        throw new Error('candidate refused');
      });
      reload = runtime.reload();
      void reload.catch(() => undefined);
      await entered;
      expect(await call()).toMatchObject({ status: 200, body: { data: { pending: [{ id: card.id }] } } });
      release();
      await expect(reload).rejects.toThrow('candidate refused');
      expect(oldAgent.toolApprovals.closed).toBe(false);
      expect(candidateAgent.toolApprovals.closed).toBe(true);
      expect(await call()).toMatchObject({ status: 200, body: { data: { pending: [{ id: card.id }] } } });
      expect(await call('resolve-tool-approval', { id: card.id, decision: 'approve' })).toMatchObject({
        status: 200,
        body: { data: { id: card.id, status: 'approved' } },
      });
      expect(oldAgent.toolApprovals.consumeApproved('session', 'group_kick', { target: 'member' })?.id).toBe(
        card.id
      );
      expect(
        oldAgent.toolApprovals.consumeApproved('session', 'group_kick', { target: 'member' })
      ).toBeUndefined();
      const pending = oldAgent.toolApprovals.enqueue({
        toolName: 'group_kick',
        category: 'member',
        sessionKey: 'pending',
        turnId: 'pending',
        args: { target: 'other' },
      });
      const originalLease = runtime.snapshots.acquire();
      const settled = oldAgent.toolApprovals.wait(pending.id).finally(() => originalLease.release());
      agentRef.current = replacementAgent;
      await runtime.reload();
      await expect(settled).resolves.toBe('expired');
      expect(oldAgent.toolApprovals.get(pending.id)?.status).toBe('expired');
      expect(() =>
        oldAgent.toolApprovals.enqueue({
          toolName: 'group_kick',
          category: 'member',
          sessionKey: 'stale',
          turnId: 'stale',
          args: {},
        })
      ).toThrow(/closed/);
      expect(await call()).toMatchObject({ status: 200, body: { data: { pending: [] } } });
      const fresh = replacementAgent.toolApprovals.enqueue({
        toolName: 'group_kick',
        category: 'member',
        sessionKey: 'fresh',
        turnId: 'fresh',
        args: {},
      });
      expect(await call()).toMatchObject({ status: 200, body: { data: { pending: [{ id: fresh.id }] } } });
      await runtime.stop();
      expect(replacementAgent.toolApprovals.closed).toBe(true);
      expect(replacementAgent.toolApprovals.get(fresh.id)?.status).toBe('expired');
    } finally {
      release();
      await reload?.catch(() => undefined);
      await runtime.stop();
      oldAgent.toolApprovals.dispose();
      candidateAgent.toolApprovals.dispose();
      replacementAgent.toolApprovals.dispose();
      await oldAgent.dispose();
      await candidateAgent.dispose();
      await replacementAgent.dispose();
      await rm(project, { recursive: true, force: true });
    }
  });

  it('auto-seeds initial inference graph from ai.plan.yml when the database graph is empty', async () => {
    const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-ai-plan-seed-')));
    try {
      await writeFile(
        join(project, 'ai.plan.yml'),
        [
          'version: 1',
          'services:',
          '  openai:',
          '    driver: openai',
          '    models:',
          '      gpt-4o:',
          '        id: gpt-4o',
          '        kinds: [language]',
          '        protocol: openai-chat',
          '        input: [text]',
          'accounts:',
          '  openai:',
          '    service: openai',
          '    auth:',
          '      method: api-key',
          '      source: env://AI_API_KEY',
          'profiles:',
          '  openai:gpt-4o:',
          '    account: openai',
          '    model: gpt-4o',
          'purposes:',
          '  chat:',
          '    profile: openai:gpt-4o',
          '',
        ].join('\n'),
        'utf8',
      );
      const inference = inferenceFor(project);
      expect(await inference.repository.readGraph({ rootId: inference.rootId })).toBeUndefined();
      const installer = installAgentHost({
        runtime: {} as never,
        im: {} as never,
        projectRoot: project,
        inference,
      });
      await installer(context(new Scope()));
      const seeded = await inference.repository.readGraph({ rootId: inference.rootId });
      expect(seeded).toBeDefined();
      expect(seeded?.revision).toBe(1);
      expect(Object.values(seeded?.services ?? {}).map(s => s.driver.id)).toEqual(['openai']);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});
