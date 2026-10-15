import { agentHostToken } from '@zhin.js/agent/runtime';
import { ingressRouteToken } from '@zhin.js/core/runtime';
import { workroomHostToken } from '@zhin.js/workroom';
import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const seedPresets = vi.fn(async () => 3);

vi.mock('../../../src/plugin-runtime/agent/runtime-foundation.js', () => ({
  AgentRuntimeFoundation: {
    create: vi.fn(async () => ({
      service: {
        getBindingRegistry: () => ({
          requireZhinBinding: () => ({ name: 'zhin', providerAlias: 'p', model: 'm' }),
        }),
        listProviders: () => [],
      },
      agent: { getSubagentSystem: () => undefined },
      knowledgeIndex: undefined,
      semanticMemory: null,
      scheduleTools: [],
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

function context(resources: Scope) {
  return {
    generation: 1,
    signal: new AbortController().signal,
    resources,
    lifecycle: { add: vi.fn() },
    handoff: { add: vi.fn() },
    config: { get: (key: string) => key === 'ai' ? { enabled: true } : undefined },
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
  beforeEach(() => seedPresets.mockClear());

  it('starts the Agent without Workroom: no Workroom Host port, presets still seeded', async () => {
    const resources = new Scope(rootPluginId());
    await install()(context(resources));

    expect(resources.has(agentHostToken)).toBe(true);
    expect(resources.has(ingressRouteToken)).toBe(true);
    expect(resources.has(workroomHostToken)).toBe(false);
    expect(seedPresets).toHaveBeenCalledTimes(1);
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
