import { describe, expect, it, vi, afterEach } from 'vitest';
import { createInboundTurnPipeline } from '../../src/collaboration/inbound-turn-pipeline.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';
import {
  getCollaborationSceneService,
  resetCollaborationSceneService,
} from '../../src/collaboration/scene-service.js';
import { getAgentRuntimeRegistry, resetAgentRuntimeRegistry } from '../../src/collaboration/runtime-registry.js';
import { MemoryCollaborationSceneRepository } from '../../src/collaboration/collaboration-scene-repository.js';
import { initOrchestrationService } from '../../src/orchestrator/orchestration-service.js';
import { MemoryOrchestrationRepository } from '../../src/orchestrator/orchestration-repository.js';
import { registerDefaultExecutors } from '../../src/orchestrator/bootstrap-executors.js';

vi.mock('../../src/collaboration/collaboration-dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/collaboration/collaboration-dispatch.js')>();
  return {
    ...actual,
    dispatchPeerTask: vi.fn(),
  };
});

import { dispatchPeerTask } from '../../src/collaboration/collaboration-dispatch.js';

describe('createInboundTurnPipeline', () => {
  afterEach(() => {
    resetCollaborationSceneService();
    resetAgentRuntimeRegistry();
    vi.mocked(dispatchPeerTask).mockReset();
  });

  it('does not inject legacy collaboration delegation tools for cell members', async () => {
    resetCollaborationSceneService();
    const repo = new MemoryCollaborationSceneRepository();
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
    getCollaborationSceneService().setRepository(repo);
    await getCollaborationSceneService().reloadFromRepository();

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
      getSubagentSystem: () => null,
      initInboundTurnContext: vi.fn(),
      process,
      processMultimodal: vi.fn(),
      configure: vi.fn(),
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

  it('does not special-case ordered group requests in the default inbound path', async () => {
    resetCollaborationSceneService();
    const repo = new MemoryCollaborationSceneRepository();
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
    getCollaborationSceneService().setRepository(repo);
    await getCollaborationSceneService().reloadFromRepository();

    const replies: unknown[] = [];
    const process = vi.fn(async () => [{ type: 'text', text: 'agent handled ordered group request' }]);
    const zhinAgent = {
      getSubagentSystem: () => null,
      initInboundTurnContext: vi.fn(),
      process,
      processMultimodal: vi.fn(),
      configure: vi.fn(),
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
        { type: 'text', data: { text: ' 组织大家按顺序同步项目进展' } },
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
            getBinding: () => null,
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
      replyOutbound: async (payload) => {
        replies.push(payload);
      },
    });

    await pipeline(message, '组织大家按顺序同步项目进展');

    expect(process).toHaveBeenCalled();
    expect(JSON.stringify(replies)).not.toContain('开始自动接管');
  });

  it('executes spawn_task turn plans through SubagentSystem', async () => {
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
    const zhinAgent = {
      getSubagentSystem: () => ({ spawnSync }),
      getEventEmitter: () => ({
        emit: vi.fn(),
        createPayload: vi.fn(() => ({})),
      }),
      initInboundTurnContext: vi.fn(),
      process,
      processMultimodal: vi.fn(),
      configure: vi.fn(),
      getLastTurnMetrics: () => null,
    };
    const aiService = {
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
    };
    const refs = { aiService, zhinAgent } as any;
    registerDefaultExecutors(initOrchestrationService(new MemoryOrchestrationRepository()), { refs });
    const pipeline = createInboundTurnPipeline({
      root: { inject: () => undefined } as any,
      ai: {
        isReady: () => true,
        getAccessConfig: () => undefined,
        getResidentToolsAsTools: () => [],
      } as any,
      refs,
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
    expect(replies[0]).toEqual([{ type: 'text', data: { text: 'vision result' } }]);
  });

  it('kernel spawn_task empty summary sends IM fallback', async () => {
    const spawnSync = vi.fn(async () => '');
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
    const zhinAgent = {
      getSubagentSystem: () => ({ spawnSync }),
      getEventEmitter: () => ({
        emit: vi.fn(),
        createPayload: vi.fn(() => ({})),
      }),
      initInboundTurnContext: vi.fn(),
      process,
      processMultimodal: vi.fn(),
      configure: vi.fn(),
      getLastTurnMetrics: () => null,
    };
    const aiService = {
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
    };
    const refs = { aiService, zhinAgent } as any;
    registerDefaultExecutors(initOrchestrationService(new MemoryOrchestrationRepository()), { refs });
    const pipeline = createInboundTurnPipeline({
      root: { inject: () => undefined } as any,
      ai: {
        isReady: () => true,
        getAccessConfig: () => undefined,
        getResidentToolsAsTools: () => [],
      } as any,
      refs,
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

    expect(spawnSync).toHaveBeenCalled();
    expect(replies).toEqual(['任务已完成，但没有可展示的文本结果。']);
  });

  it('kernel spawn_task failure sends errorTemplate IM reply', async () => {
    const spawnSync = vi.fn(async () => {
      throw new Error('subagent boom');
    });
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
    const zhinAgent = {
      getSubagentSystem: () => ({ spawnSync }),
      getEventEmitter: () => ({
        emit: vi.fn(),
        createPayload: vi.fn(() => ({})),
      }),
      initInboundTurnContext: vi.fn(),
      process,
      processMultimodal: vi.fn(),
      configure: vi.fn(),
      getLastTurnMetrics: () => null,
    };
    const aiService = {
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
    };
    const refs = { aiService, zhinAgent } as any;
    registerDefaultExecutors(initOrchestrationService(new MemoryOrchestrationRepository()), { refs });
    const pipeline = createInboundTurnPipeline({
      root: { inject: () => undefined } as any,
      ai: {
        isReady: () => true,
        getAccessConfig: () => undefined,
        getResidentToolsAsTools: () => [],
      } as any,
      refs,
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

    expect(spawnSync).toHaveBeenCalled();
    expect(process).not.toHaveBeenCalled();
    expect(replies).toEqual(['ERR subagent boom']);
  });

  it('delegates to peer endpoint without local process when turn plan routes to another cell member', async () => {
    resetCollaborationSceneService();
    const repo = new MemoryCollaborationSceneRepository();
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
    getCollaborationSceneService().setRepository(repo);
    await getCollaborationSceneService().reloadFromRepository();

    vi.mocked(dispatchPeerTask).mockResolvedValue({
      runId: 'run-1',
      taskId: 'task-1',
      task: { id: 'task-1', status: 'waiting_result' } as any,
    });

    const process = vi.fn(async () => [{ type: 'text', text: 'should not run' }]);
    const zhinAgent = {
      getSubagentSystem: () => null,
      initInboundTurnContext: vi.fn(),
      process,
      processMultimodal: vi.fn(),
      configure: vi.fn(),
      getLastTurnMetrics: () => null,
    };
    getAgentRuntimeRegistry().registerForEndpoint('8596238', zhinAgent as any);

    const researcherBinding = {
      name: 'researcher',
      providerAlias: 'mock',
      model: 'mock-model',
      mcpServers: [],
    };
    const message = {
      ...mockCommMessage({
        adapter: 'icqq',
        endpoint: '8596238',
        scope: 'group',
        sceneId: '373460458',
      }),
      $content: [
        { type: 'at', data: { qq: '8596238' } },
        { type: 'text', data: { text: ' delegate to researcher peer' } },
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
            agents: {
              zhin: { provider: 'mock', model: 'mock-model' },
              researcher: {
                provider: 'mock',
                model: 'mock-model',
                priority: 10,
                match: { contentContains: 'delegate to researcher' },
              },
            },
          }),
          getBindingRegistry: () => ({
            getDiscoveredAgentNames: () => new Set(['zhin', 'researcher']),
            getBinding: (name: string) => (name === 'researcher' ? researcherBinding : null),
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

    await pipeline(message, 'delegate to researcher peer');

    expect(dispatchPeerTask).toHaveBeenCalledWith(expect.objectContaining({
      fromEndpointId: '8596238',
      toEndpointId: '210723495',
    }));
    expect(process).not.toHaveBeenCalled();
  });
});
