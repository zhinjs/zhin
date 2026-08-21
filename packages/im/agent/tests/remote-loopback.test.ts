/**
 * L4 loopback remoteAgents — A2A sendMessage → getTask (mocked client).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskState } from '@a2a-js/sdk';
import {
  createGenerationAdmissionGate,
  replaceGenerationAdmissions,
} from '../../plugin-runtime/src/admission.js';
import { MemoryOrchestrationRepository } from '../src/orchestrator/orchestration-repository.js';
import { createTestOrchestrationService } from './helpers/orchestration.js';
import type { OrchestrationService } from '../src/orchestrator/orchestration-service.js';
import {
  RemoteAgentRegistry,
} from '../src/orchestrator/remote-agent-registry.js';
import {
  executeRemoteOrchestrationTask,
  startRemoteTaskRecovery,
} from '../src/orchestrator/remote-task-executor.js';

describe('Remote loopback A2A delegate flow', () => {
  let repo: MemoryOrchestrationRepository;
  let orchestration: OrchestrationService;
  beforeEach(() => {
    repo = new MemoryOrchestrationRepository();
    orchestration = createTestOrchestrationService(repo);
  });

  it('delegate → poll completed via mocked A2A client', async () => {
    const run = await repo.createRun({ session_key: 's1', title: 'remote task' });
    const task = await repo.createTask({
      run_id: run.id,
      name: 'Remote work',
      role: 'zhin',
      executor_kind: 'remote_mesh',
      remote_agent_id: 'local',
    });
    orchestration.dispatcherHandle.syncTaskFromRecord(task);

    const remoteTaskId = 'rt-abc123';
    const sendMessage = vi.fn().mockResolvedValue({
      id: remoteTaskId,
      contextId: 'ctx-1',
      status: { state: TaskState.TASK_STATE_WORKING },
      artifacts: [],
      history: [],
    });
    const getTask = vi.fn()
      .mockResolvedValue({
        id: remoteTaskId,
        contextId: 'ctx-1',
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          message: {
            messageId: 'm1',
            contextId: 'ctx-1',
            taskId: remoteTaskId,
            role: 2,
            parts: [{ content: { $case: 'text', value: 'Task finished successfully' }, metadata: undefined, filename: '', mediaType: 'text/plain' }],
            metadata: undefined,
            extensions: [],
            referenceTaskIds: [],
          },
        },
        artifacts: [{
          artifactId: 'a1',
          name: 'result',
          description: '',
          parts: [{ content: { $case: 'text', value: 'Task finished successfully' }, metadata: undefined, filename: '', mediaType: 'text/plain' }],
          metadata: undefined,
          extensions: [],
        }],
        history: [],
      });

    const registry = new RemoteAgentRegistry();
    registry.loadFromConfig({
      remoteAgents: [{
        id: 'local',
        cardUrl: 'http://127.0.0.1:8069/a2a/zhin/.well-known/agent-card.json',
        token: 't',
      }],
    });
    registry.list()[0]!.card = {
      name: 'local',
      description: 'test',
      version: '1.0.0',
      supportedInterfaces: [{
        url: 'https://remote.example/rpc',
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
        tenant: '',
      }],
      capabilities: { streaming: false, extensions: [] },
      securitySchemes: {},
      securityRequirements: [],
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [],
      signatures: [],
    };

    vi.spyOn(registry, 'getA2aClient').mockResolvedValue({
      sendMessage,
      sendMessageStream: vi.fn(),
      getTask,
      cancelTask: vi.fn(),
    } as never);

    const delegate = await executeRemoteOrchestrationTask(orchestration, registry, task.id);
    expect(delegate.ok).toBe(true);

    await vi.waitFor(async () => {
      expect((await repo.getTask(task.id))?.status).toBe('completed');
    });
    expect(sendMessage).toHaveBeenCalled();
    expect(getTask).toHaveBeenCalledWith({ id: remoteTaskId, tenant: '' });
  });

  it('marks kernel task failed when A2A sendMessage throws', async () => {
    const run = await repo.createRun({ session_key: 's2', title: 'remote fail' });
    const task = await repo.createTask({
      run_id: run.id,
      name: 'Remote work',
      role: 'zhin',
      executor_kind: 'remote_mesh',
      remote_agent_id: 'local',
      status: 'running',
    });
    orchestration.dispatcherHandle.syncTaskFromRecord(task);

    const registry = new RemoteAgentRegistry();
    registry.loadFromConfig({
      remoteAgents: [{
        id: 'local',
        cardUrl: 'http://127.0.0.1:8069/a2a/zhin/.well-known/agent-card.json',
        token: 't',
      }],
    });
    registry.list()[0]!.card = {
      name: 'local',
      description: 'test',
      version: '1.0.0',
      supportedInterfaces: [{
        url: 'https://remote.example/rpc',
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
        tenant: '',
      }],
      capabilities: { streaming: false, extensions: [] },
      securitySchemes: {},
      securityRequirements: [],
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [],
      signatures: [],
    };

    vi.spyOn(registry, 'getA2aClient').mockResolvedValue({
      sendMessage: vi.fn().mockRejectedValue(new Error('A2A unavailable')),
      sendMessageStream: vi.fn(),
      getTask: vi.fn(),
      cancelTask: vi.fn(),
    });

    const delegate = await executeRemoteOrchestrationTask(orchestration, registry, task.id);
    expect(delegate.ok).toBe(false);

    const updated = await repo.getTask(task.id);
    expect(updated?.status).toBe('failed');
    expect(updated?.error).toContain('A2A unavailable');
  });

  it('recovers a persisted remote task only after its generation is admitted', async () => {
    const run = await repo.createRun({ session_key: 'recovery', title: 'remote recovery' });
    const task = await repo.createTask({
      run_id: run.id,
      name: 'Recover remote work',
      role: 'zhin',
      executor_kind: 'remote_mesh',
      remote_agent_id: 'local',
      status: 'waiting_result',
    });
    await repo.updateTaskStatus(task.id, 'waiting_result', { remote_task_id: 'rt-recovery' });

    const registry = new RemoteAgentRegistry();
    registry.loadFromConfig({
      remoteAgents: [{ id: 'local', cardUrl: 'https://remote.example/card' }],
    });
    registry.list()[0]!.card = {
      name: 'local',
      description: 'test',
      version: '1.0.0',
      supportedInterfaces: [{
        url: 'https://remote.example/rpc',
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
        tenant: '',
      }],
      capabilities: { streaming: false, extensions: [] },
      securitySchemes: {},
      securityRequirements: [],
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [],
      signatures: [],
    };
    vi.spyOn(registry, 'getA2aClient').mockResolvedValue({
      sendMessage: vi.fn(),
      sendMessageStream: vi.fn(),
      getTask: vi.fn().mockResolvedValue({
        id: 'rt-recovery',
        contextId: 'ctx',
        status: { state: TaskState.TASK_STATE_COMPLETED },
        artifacts: [],
        history: [],
      }),
      cancelTask: vi.fn(),
    } as never);

    const admission = createGenerationAdmissionGate();
    const owner = {};
    replaceGenerationAdmissions(new Set(), new Set([admission]), owner, () => () => undefined);
    const stop = startRemoteTaskRecovery(orchestration, registry, admission);
    try {
      await vi.waitFor(async () => {
        expect((await repo.getTask(task.id))?.status).toBe('completed');
      });
    } finally {
      stop();
      replaceGenerationAdmissions(new Set([admission]), new Set(), owner);
      await registry.dispose();
    }
  });
});
