import { agentHostToken } from '@zhin.js/agent/runtime';
import { ingressRouteToken } from '@zhin.js/core/runtime';
import { workroomHostToken } from '@zhin.js/workroom';
import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const seedPresets = vi.fn(async () => 3);
// Real ZhinAgent so the test exercises its actual SessionSystem persistence latch.
const agentRef: { current?: InstanceType<typeof import('@zhin.js/agent/runtime').ZhinAgent> } = {};

vi.mock('../../../src/plugin-runtime/agent/runtime-foundation.js', () => ({
  AgentRuntimeFoundation: {
    create: vi.fn(async () => ({
      service: {
        getBindingRegistry: () => ({
          requireZhinBinding: () => ({ name: 'zhin', providerAlias: 'p', model: 'm' }),
        }),
        listProviders: () => [],
      },
      agent: agentRef.current,
      knowledgeIndex: undefined,
      semanticMemory: null,
      scheduleTools: [],
      schedule: { start: vi.fn() },
      homeTools: [],
      assistantEnabled: false,
      seedPresets: () => seedPresets(),
      listBindings: () => [],
    })),
  },
}));
vi.mock('../../../src/plugin-runtime/agent/tool-feature-publisher.js', () => ({
  publishAgentToolFeatures: vi.fn(),
}));
vi.mock('../../../src/plugin-runtime/agent/publication-coordinator.js', () => ({
  AgentHostPublicationCoordinator: class {
    constructor(options: { resources: Scope }) {
      options.resources.provide(agentHostToken, {} as never);
    }
  },
}));

const { installAgentHost } = await import('../../../src/plugin-runtime/agent/host-installer.js');
const { ZhinAgent } = await import('@zhin.js/agent/runtime');
const { SdkProviderAdapter } = await import('@zhin.js/ai');

function context(resources: Scope) {
  return {
    generation: 1,
    signal: new AbortController().signal,
    resources,
    lifecycle: { add: vi.fn() },
    handoff: { add: vi.fn() },
    config: { get: (key: string) => key === 'ai' ? { enabled: true, sessions: { useDatabase: false } } : undefined },
    addFeature: vi.fn(),
  } as never;
}

function install(workroom?: unknown) {
  return installAgentHost({
    runtime: {} as never,
    workroomStorageMode: 'file',
    im: {} as never,
    projectRoot: process.cwd(),
    ...(workroom ? { workroom: workroom as never } : {}),
  });
}

describe('installAgentHost optional Workroom', () => {
  beforeEach(() => {
    seedPresets.mockClear();
    // Offline provider: never called, the installer only composes the Agent.
    agentRef.current = new ZhinAgent(new SdkProviderAdapter('mock', 'openai', { sdk: 'openai', apiKey: 'test-key' }, ['m']), {});
  });
  afterEach(() => { vi.useRealTimers(); });

  it('starts the Agent without Workroom: no Workroom Host port, presets still seeded', async () => {
    const resources = new Scope(rootPluginId());
    await install()(context(resources));

    expect(resources.has(agentHostToken)).toBe(true);
    expect(resources.has(ingressRouteToken)).toBe(true);
    expect(resources.has(workroomHostToken)).toBe(false);
    expect(seedPresets).toHaveBeenCalledTimes(1);
  });

  it('marks Agent persistence ready without Workroom so the first turn does not wait for the timeout (#857)', async () => {
    const resources = new Scope(rootPluginId());
    await install()(context(resources));

    // Before the fix nothing opened the latch: this wait only settled when the
    // SessionSystem fallback timer fired (5 s in production) and logged a warning.
    vi.useFakeTimers();
    let settled = false;
    void agentRef.current!.waitForMemoryPersistence().then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('owns the Agent persistence latch even when Workroom is installed', async () => {
    const markReady = vi.spyOn(agentRef.current!, 'markMemoryPersistenceReady');
    const workroom = {
      WorkroomHostAssembly: {
        begin: vi.fn(() => ({ compose: vi.fn(async () => ({ presetCount: 0, persistence: { pendingActivation: true } })) })),
      },
    };
    await install(workroom)(context(new Scope(rootPluginId())));
    expect(markReady).toHaveBeenCalledOnce();
  });

  it('fails closed when an installed Workroom fails to compose (not downgraded to not-installed)', async () => {
    const failure = new Error('journal corrupt');
    const workroom = {
      WorkroomHostAssembly: {
        begin: vi.fn(() => ({ compose: vi.fn(async () => { throw failure; }) })),
      },
    };
    const resources = new Scope(rootPluginId());

    await expect(install(workroom)(context(resources))).rejects.toBe(failure);
    expect(resources.has(ingressRouteToken)).toBe(false);
    expect(seedPresets).not.toHaveBeenCalled();
  });
});
