import { describe, expect, it, vi, afterEach } from 'vitest';
import { createInboundTurnPipeline } from '../../src/collaboration/inbound-turn-pipeline.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';
import {
  getCollaborationCellService,
  resetCollaborationCellService,
} from '../../src/collaboration/cell-service.js';
import { getAgentRuntimeRegistry, resetAgentRuntimeRegistry } from '../../src/collaboration/runtime-registry.js';
import { MemoryCollaborationCellRepository } from '../../src/collaboration/collaboration-cell-repository.js';

describe('createInboundTurnPipeline', () => {
  afterEach(() => {
    resetCollaborationCellService();
    resetAgentRuntimeRegistry();
  });

  it('does not inject legacy collaboration delegation tools for cell members', async () => {
    resetCollaborationCellService();
    const repo = new MemoryCollaborationCellRepository();
    await repo.upsert({
      id: 'icqq-collab-room',
      adapter: 'icqq',
      sceneId: '373460458',
      goal: 'test',
      members: [
        { endpointId: '8596238', primary: 'planner', pipelineRole: 'planner' },
        { endpointId: '210723495', primary: 'researcher', pipelineRole: 'researcher' },
      ],
    });
    getCollaborationCellService().setRepository(repo);
    await getCollaborationCellService().reloadFromRepository();

    let capturedTools: { name: string }[] = [];
    const process = vi.fn(async (_content, _msg, externalTools: { name: string }[]) => {
      capturedTools = externalTools ?? [];
      return [{ type: 'text', text: 'ok' }];
    });
    const plannerBinding = {
      name: 'planner',
      providerAlias: 'mock',
      model: 'mock-model',
      mcpServers: [],
    };
    const zhinAgent = {
      getSubagentManager: () => null,
      process,
      processMultimodal: vi.fn(),
      setActiveBinding: vi.fn(),
      getLastTurnMetrics: () => null,
    };
    getAgentRuntimeRegistry().registerForEndpoint('8596238', zhinAgent as any);

    const message = {
      ...mockCommMessage({
        adapter: 'icqq',
        endpoint: '8596238',
        scope: 'group',
        sceneId: '373460458',
      }),
      $content: [
        { type: 'at', data: { qq: '8596238' } },
        { type: 'text', data: { text: ' 请委派 researcher' } },
      ],
    };

    const pipeline = createInboundTurnPipeline({
      root: { inject: () => undefined } as any,
      ai: {
        isReady: () => true,
        getAccessConfig: () => undefined,
        getResidentToolsAsTools: () => [],
      } as any,
      refs: {
        aiService: {
          isReady: () => true,
          getProvider: () => ({ name: 'mock', models: ['mock-model'] }),
          getRoutingConfig: () => ({
            agents: { zhin: { provider: 'mock', model: 'mock-model' } },
          }),
          getBindingRegistry: () => ({
            getDiscoveredAgentNames: () => new Set(['zhin', 'planner']),
            getBinding: (name: string) => (name === 'planner' ? plannerBinding : null),
            requireZhinBinding: () => ({
              name: 'zhin',
              providerAlias: 'mock',
              model: 'mock-model',
              mcpServers: [],
            }),
          }),
          setDiscoveredAgents: () => undefined,
        },
        zhinAgent,
      } as any,
      triggerConfig: {
        errorTemplate: 'ERR {error}',
        resolveQuotedMessages: false,
      } as any,
      peerMode: 'mention-only',
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      replyOutbound: vi.fn(),
    });

    await pipeline(message, '请委派 researcher');

    expect(process).toHaveBeenCalled();
    expect(capturedTools.map((t) => t.name)).not.toContain('group_delegate');
    expect(capturedTools.map((t) => t.name)).not.toContain('cell_advance_stage');
  });

  it('executes spawn_task turn plans through SubagentManager', async () => {
    const spawnSync = vi.fn(async () => 'vision result');
    const process = vi.fn(async () => [{ type: 'text', text: 'local result' }]);
    const replies: unknown[] = [];
    const message = {
      ...mockCommMessage({ adapter: 'sandbox', endpoint: 'solo-bot', scope: 'private' }),
      $content: [{ type: 'text', data: { text: 'please route this' } }],
    };
    const binding = {
      name: 'vision',
      providerAlias: 'mock',
      model: 'mock-model',
      mcpServers: [],
    };
    const pipeline = createInboundTurnPipeline({
      root: { inject: () => undefined } as any,
      ai: {
        isReady: () => true,
        getAccessConfig: () => undefined,
        getResidentToolsAsTools: () => [],
      } as any,
      refs: {
        aiService: {
          isReady: () => true,
          getProvider: () => ({ name: 'mock', models: ['mock-model'] }),
          getRoutingConfig: () => ({
            agents: {
              zhin: { provider: 'mock', model: 'mock-model' },
              vision: {
                provider: 'mock',
                model: 'mock-model',
                priority: 10,
                match: { contentContains: 'route this' },
              },
            },
          }),
          getBindingRegistry: () => ({
            getDiscoveredAgentNames: () => new Set(['zhin', 'vision']),
            getBinding: (name: string) => name === 'vision' ? binding : null,
            requireZhinBinding: () => ({
              name: 'zhin',
              providerAlias: 'mock',
              model: 'mock-model',
              mcpServers: [],
            }),
          }),
          setDiscoveredAgents: () => undefined,
        },
        zhinAgent: {
          getSubagentManager: () => ({ spawnSync }),
          process,
          processMultimodal: vi.fn(),
          setActiveBinding: vi.fn(),
          getLastTurnMetrics: () => null,
        },
      } as any,
      triggerConfig: {
        errorTemplate: 'ERR {error}',
        resolveQuotedMessages: false,
      } as any,
      peerMode: 'mention-only',
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      replyOutbound: async (payload) => {
        replies.push(payload);
      },
    });

    await pipeline(message, 'please route this');

    expect(spawnSync).toHaveBeenCalledWith(expect.objectContaining({
      agent: 'vision',
      label: 'vision',
      task: 'please route this',
      binding,
      notifyContext: expect.any(Object),
    }));
    expect(process).not.toHaveBeenCalled();
    expect(replies).toEqual([[{ type: 'text', data: { text: 'vision result' } }]]);
  });
});
