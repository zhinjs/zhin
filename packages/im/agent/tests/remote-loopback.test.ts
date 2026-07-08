/**
 * L4 loopback remoteAgents — A2A sendMessage → getTask (mocked client).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskState } from '@a2a-js/sdk';
import { MemoryOrchestrationRepository } from '../src/orchestrator/orchestration-repository.js';
import { initOrchestrationService } from '../src/orchestrator/orchestration-service.js';
import { getAgentDispatcher } from '../src/orchestrator/agent-dispatcher.js';
import {
  RemoteAgentRegistry,
  initRemoteAgentRegistry,
} from '../src/orchestrator/remote-agent-registry.js';
import {
  executeRemoteOrchestrationTask,
  pollRemoteTaskStatus,
} from '../src/orchestrator/remote-task-executor.js';

describe('Remote loopback A2A delegate flow', () => {
  let repo: MemoryOrchestrationRepository;

  beforeEach(() => {
    repo = new MemoryOrchestrationRepository();
    initOrchestrationService(repo);
    getAgentDispatcher().setRepository(repo);
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
    getAgentDispatcher().syncTaskFromRecord(task);

    const remoteTaskId = 'rt-abc123';
    const sendMessage = vi.fn().mockResolvedValue({
      id: remoteTaskId,
      contextId: 'ctx-1',
      status: { state: TaskState.TASK_STATE_WORKING },
      artifacts: [],
      history: [],
    });
    const getTask = vi.fn()
      .mockResolvedValueOnce({
        id: remoteTaskId,
        contextId: 'ctx-1',
        status: { state: TaskState.TASK_STATE_WORKING },
        artifacts: [],
        history: [],
      })
      .mockResolvedValueOnce({
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

    const registry = await initRemoteAgentRegistry({
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
      supportedInterfaces: [],
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

    const delegate = await executeRemoteOrchestrationTask(task.id);
    expect(delegate.ok).toBe(true);

    const updated = await repo.getTask(task.id);
    expect(updated?.remote_task_id).toBe(remoteTaskId);
    getAgentDispatcher().syncTaskFromRecord(updated!);

    const poll1 = await pollRemoteTaskStatus(task.id);
    expect(poll1.done).toBe(false);

    const poll2 = await pollRemoteTaskStatus(task.id);
    expect(poll2.done).toBe(true);
    expect(poll2.status).toBe('completed');
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
    getAgentDispatcher().syncTaskFromRecord(task);

    const registry = await initRemoteAgentRegistry({
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
      supportedInterfaces: [],
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

    const delegate = await executeRemoteOrchestrationTask(task.id);
    expect(delegate.ok).toBe(false);

    const updated = await repo.getTask(task.id);
    expect(updated?.status).toBe('failed');
    expect(updated?.error).toContain('A2A unavailable');
  });
});
