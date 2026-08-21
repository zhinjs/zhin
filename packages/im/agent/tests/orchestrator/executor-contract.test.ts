/**
 * Orchestration SSOT v1 — Executor × terminal state contract matrix.
 * Each executor kind must reach Kernel terminal states (not stuck waiting_result).
 */
import { describe, expect, it, vi } from 'vitest';
import { TaskState, Role } from '@a2a-js/sdk';

import { MemoryOrchestrationRepository } from '../../src/orchestrator/orchestration-repository.js';
import { createTestOrchestrationService } from '../helpers/orchestration.js';
import type { AgentExecutor } from '../../src/orchestrator/orchestration-types.js';
import {
  executeRemoteOrchestrationTask,
  pollRemoteTaskStatus,
} from '../../src/orchestrator/remote-task-executor.js';
import {
  RemoteAgentRegistry,
} from '../../src/orchestrator/remote-agent-registry.js';
import {
  normalizeExecutorKind,
  normalizeRunSource,
} from '../../src/orchestrator/orchestration-mappers.js';

describe('Orchestration persistence contract', () => {
  it('rejects removed executor kinds instead of silently changing execution domains', () => {
    expect(() => normalizeExecutorKind('internal_room')).toThrow(TypeError);
    expect(() => normalizeExecutorKind('im_projection')).toThrow(TypeError);
  });

  it('accepts only canonical run sources', () => {
    expect(normalizeRunSource({
      kind: 'im_scene',
      scene: {
        platform: 'sandbox',
        endpointKey: 'assistant',
        sceneId: 'room',
        kind: 'group',
      },
    })).toEqual({
      kind: 'im_scene',
      scene: {
        platform: 'sandbox',
        endpointKey: 'assistant',
        sceneId: 'room',
        kind: 'group',
      },
    });
    expect(normalizeRunSource({ kind: 'im_cell', cellId: 'legacy' })).toBeUndefined();
    expect(normalizeRunSource({ kind: 'im_session', endpointKey: 'legacy' })).toBeUndefined();
  });
});

describe('Executor contract — local', () => {
  it('success: result event → completed + result_summary', async () => {
    const kernel = createTestOrchestrationService(new MemoryOrchestrationRepository());
    const run = await kernel.startRun({ sessionKey: 'local-ok' });
    const dispatched = await kernel.dispatchTask({
      runId: run.run.id,
      name: 'work',
      executorKind: 'local',
      autoStart: false,
    });

    const executor: AgentExecutor = {
      kind: 'local',
      async *execute() {
        yield { type: 'result', result: 'local done' };
      },
    };

    const task = await kernel.runTask(dispatched.task.id, undefined, executor);
    expect(task.status).toBe('completed');
    expect(task.resultSummary).toBe('local done');
  });

  it('fail: error event → failed', async () => {
    const kernel = createTestOrchestrationService(new MemoryOrchestrationRepository());
    const run = await kernel.startRun({ sessionKey: 'local-fail' });
    const dispatched = await kernel.dispatchTask({
      runId: run.run.id,
      name: 'work',
      executorKind: 'local',
      autoStart: false,
    });

    const executor: AgentExecutor = {
      kind: 'local',
      async *execute() {
        yield { type: 'error', error: 'local executor failed' };
      },
    };

    const task = await kernel.runTask(dispatched.task.id, undefined, executor);
    expect(task.status).toBe('failed');
    expect(task.error).toContain('local executor failed');
  });

  it('cancel: cancelTask on running → cancelled', async () => {
    const repo = new MemoryOrchestrationRepository();
    const kernel = createTestOrchestrationService(repo);
    const run = await kernel.startRun({ sessionKey: 'local-cancel' });
    const task = await kernel.addTask({ runId: run.run.id, name: 'work' });
    await repo.updateTaskStatus(task.id, 'running', { started_at: Date.now() });

    const cancelled = await kernel.cancelTask(task.id, 'user cancelled');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.error).toContain('user cancelled');
  });
});

describe('Executor contract — remote_mesh', () => {
  function stubA2aClient(registry: RemoteAgentRegistry, client: {
    sendMessage: ReturnType<typeof vi.fn>;
    sendMessageStream?: ReturnType<typeof vi.fn>;
    getTask: ReturnType<typeof vi.fn>;
  }) {
    const entry = registry.list()[0];
    if (entry) {
      entry.card = {
        name: 'local',
        description: 'test',
        version: '1.0.0',
        supportedInterfaces: [{
          url: 'https://remote.example/rpc',
          protocolBinding: 'JSONRPC',
          protocolVersion: '1.0',
          tenant: '',
        }],
        capabilities: { streaming: client.sendMessageStream !== undefined, extensions: [] },
        securitySchemes: {},
        securityRequirements: [],
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        skills: [],
        signatures: [],
      };
    }
    vi.spyOn(registry, 'getA2aClient').mockResolvedValue({
      sendMessage: client.sendMessage,
      sendMessageStream: client.sendMessageStream ?? vi.fn(),
      getTask: client.getTask,
      cancelTask: vi.fn(),
    });
  }

  it('success: delegate → poll completed', async () => {
    const repo = new MemoryOrchestrationRepository();
    const orchestration = createTestOrchestrationService(repo);

    const run = await repo.createRun({ session_key: 'remote-ok', title: 'r' });
    const task = await repo.createTask({
      run_id: run.id,
      name: 'Remote',
      role: 'subtask',
      executor_kind: 'remote_mesh',
      remote_agent_id: 'local',
      status: 'running',
    });
    orchestration.dispatcherHandle.syncTaskFromRecord(task);

    const remoteTaskId = 'rt-1';
    const registry = new RemoteAgentRegistry();
    registry.loadFromConfig({
      remoteAgents: [{ id: 'local', cardUrl: 'http://127.0.0.1:8068/a2a/zhin/.well-known/agent-card.json', token: 't' }],
    });
    stubA2aClient(registry, {
      sendMessage: vi.fn().mockResolvedValue({
        id: remoteTaskId,
        contextId: 'ctx',
        status: { state: TaskState.TASK_STATE_WORKING },
        artifacts: [],
        history: [],
      }),
      getTask: vi.fn().mockResolvedValue({
        id: remoteTaskId,
        contextId: 'ctx',
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          message: {
            messageId: 'm1',
            contextId: 'ctx',
            taskId: remoteTaskId,
            role: Role.ROLE_AGENT,
            parts: [{ content: { $case: 'text', value: 'remote result text' }, metadata: undefined, filename: '', mediaType: 'text/plain' }],
            metadata: undefined,
            extensions: [],
            referenceTaskIds: [],
          },
        },
        artifacts: [],
        history: [],
      }),
    });

    expect((await executeRemoteOrchestrationTask(orchestration, registry, task.id)).ok).toBe(true);
    const poll = await pollRemoteTaskStatus(orchestration, registry, task.id);
    expect(poll.done).toBe(true);
    expect(poll.status).toBe('completed');

    const updated = await repo.getTask(task.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.result_summary).toContain('remote result');
  });

  it('treats an A2A Message without taskId as a synchronous terminal result', async () => {
    const repo = new MemoryOrchestrationRepository();
    const orchestration = createTestOrchestrationService(repo);
    const run = await repo.createRun({ session_key: 'remote-message', title: 'r' });
    const task = await repo.createTask({
      run_id: run.id,
      name: 'Remote',
      role: 'subtask',
      executor_kind: 'remote_mesh',
      remote_agent_id: 'local',
      status: 'running',
    });
    orchestration.dispatcherHandle.syncTaskFromRecord(task);

    const registry = new RemoteAgentRegistry();
    registry.loadFromConfig({
      remoteAgents: [{ id: 'local', cardUrl: 'https://remote.example/card' }],
    });
    const getTask = vi.fn();
    stubA2aClient(registry, {
      sendMessage: vi.fn().mockResolvedValue({
        messageId: 'message-only',
        contextId: 'ctx',
        taskId: '',
        role: Role.ROLE_AGENT,
        parts: [{
          content: { $case: 'text', value: 'direct remote result' },
          metadata: undefined,
          filename: '',
          mediaType: 'text/plain',
        }],
        metadata: undefined,
        extensions: [],
        referenceTaskIds: [],
      }),
      getTask,
    });

    expect((await executeRemoteOrchestrationTask(orchestration, registry, task.id)).ok).toBe(true);
    const updated = await repo.getTask(task.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.result_summary).toContain('direct remote result');
    expect(getTask).not.toHaveBeenCalled();
  });

  it('fail: delegate throws → failed (not waiting_result)', async () => {
    const repo = new MemoryOrchestrationRepository();
    const orchestration = createTestOrchestrationService(repo);

    const run = await repo.createRun({ session_key: 'remote-fail', title: 'r' });
    const task = await repo.createTask({
      run_id: run.id,
      name: 'Remote',
      role: 'subtask',
      executor_kind: 'remote_mesh',
      remote_agent_id: 'local',
      status: 'running',
    });
    orchestration.dispatcherHandle.syncTaskFromRecord(task);

    const registry = new RemoteAgentRegistry();
    registry.loadFromConfig({
      remoteAgents: [{ id: 'local', cardUrl: 'http://127.0.0.1:8068/a2a/zhin/.well-known/agent-card.json', token: 't' }],
    });
    stubA2aClient(registry, {
      sendMessage: vi.fn().mockRejectedValue(new Error('delegate boom')),
      getTask: vi.fn(),
    });

    expect((await executeRemoteOrchestrationTask(orchestration, registry, task.id)).ok).toBe(false);
    const updated = await repo.getTask(task.id);
    expect(updated?.status).toBe('failed');
  });

  it('fails closed when an SSE delegation ends without a remote task id', async () => {
    const repo = new MemoryOrchestrationRepository();
    const orchestration = createTestOrchestrationService(repo);
    const run = await repo.createRun({ session_key: 'remote-empty-stream', title: 'r' });
    const task = await repo.createTask({
      run_id: run.id,
      name: 'Remote',
      role: 'subtask',
      executor_kind: 'remote_mesh',
      remote_agent_id: 'local',
      status: 'running',
    });
    orchestration.dispatcherHandle.syncTaskFromRecord(task);

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
      capabilities: { streaming: true, extensions: [] },
      securitySchemes: {},
      securityRequirements: [],
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [],
      signatures: [],
    };
    stubA2aClient(registry, {
      sendMessage: vi.fn(),
      sendMessageStream: vi.fn().mockReturnValue((async function* () {
        yield { message: 'non-task event' };
      })()),
      getTask: vi.fn(),
    });

    expect((await executeRemoteOrchestrationTask(orchestration, registry, task.id)).ok).toBe(true);
    await vi.waitFor(async () => {
      expect((await repo.getTask(task.id))?.status).toBe('failed');
    });
    expect((await repo.getTask(task.id))?.error).toContain('before publishing a remote task id');
  });

  it('treats an SSE Message without taskId as a synchronous terminal result', async () => {
    const repo = new MemoryOrchestrationRepository();
    const orchestration = createTestOrchestrationService(repo);
    const run = await repo.createRun({ session_key: 'remote-stream-message', title: 'r' });
    const task = await repo.createTask({
      run_id: run.id,
      name: 'Remote',
      role: 'subtask',
      executor_kind: 'remote_mesh',
      remote_agent_id: 'local',
      status: 'running',
    });
    orchestration.dispatcherHandle.syncTaskFromRecord(task);

    const registry = new RemoteAgentRegistry();
    registry.loadFromConfig({
      remoteAgents: [{ id: 'local', cardUrl: 'https://remote.example/card' }],
    });
    stubA2aClient(registry, {
      sendMessage: vi.fn(),
      sendMessageStream: vi.fn().mockReturnValue((async function* () {
        yield {
          messageId: 'stream-message-only',
          contextId: 'ctx',
          taskId: '',
          role: Role.ROLE_AGENT,
          parts: [{
            content: { $case: 'text', value: 'direct streamed result' },
            metadata: undefined,
            filename: '',
            mediaType: 'text/plain',
          }],
          metadata: undefined,
          extensions: [],
          referenceTaskIds: [],
        };
      })()),
      getTask: vi.fn(),
    });

    expect((await executeRemoteOrchestrationTask(orchestration, registry, task.id)).ok).toBe(true);
    await vi.waitFor(async () => {
      expect((await repo.getTask(task.id))?.status).toBe('completed');
    });
    expect((await repo.getTask(task.id))?.result_summary).toContain('direct streamed result');
  });

  it('cancel: remote cancelled status → cancelled terminal', async () => {
    const repo = new MemoryOrchestrationRepository();
    const orchestration = createTestOrchestrationService(repo);

    const run = await repo.createRun({ session_key: 'remote-cancel', title: 'r' });
    const task = await repo.createTask({
      run_id: run.id,
      name: 'Remote',
      role: 'subtask',
      executor_kind: 'remote_mesh',
      remote_agent_id: 'local',
      status: 'waiting_result',
    });
    await repo.updateTaskStatus(task.id, 'waiting_result', { remote_task_id: 'rt-cancel' });
    const synced = (await repo.getTask(task.id))!;
    orchestration.dispatcherHandle.syncTaskFromRecord(synced);

    const registry = new RemoteAgentRegistry();
    registry.loadFromConfig({
      remoteAgents: [{ id: 'local', cardUrl: 'http://127.0.0.1:8068/a2a/zhin/.well-known/agent-card.json', token: 't' }],
    });
    stubA2aClient(registry, {
      sendMessage: vi.fn(),
      getTask: vi.fn().mockResolvedValue({
        id: 'rt-cancel',
        contextId: 'ctx',
        status: {
          state: TaskState.TASK_STATE_CANCELED,
          message: {
            messageId: 'm',
            contextId: 'ctx',
            taskId: 'rt-cancel',
            role: Role.ROLE_AGENT,
            parts: [{ content: { $case: 'text', value: 'cancelled' }, metadata: undefined, filename: '', mediaType: 'text/plain' }],
            metadata: undefined,
            extensions: [],
            referenceTaskIds: [],
          },
        },
        artifacts: [],
        history: [],
      }),
    });

    const poll = await pollRemoteTaskStatus(orchestration, registry, task.id);
    expect(poll.done).toBe(true);
    expect(poll.status).toBe('cancelled');

    const updated = await repo.getTask(task.id);
    expect(updated?.status).toBe('cancelled');
  });
});

describe('Executor contract — snapshot API', () => {
  it('getSnapshot reflects kernel DB after completeTask', async () => {
    const kernel = createTestOrchestrationService(new MemoryOrchestrationRepository());
    const run = await kernel.startRun({ sessionKey: 'snap' });
    const task = await kernel.addTask({ runId: run.run.id, name: 't1' });
    await kernel.completeTask(task.id, 'snapshot body');

    const snapshot = await kernel.getSnapshot(run.run.id);
    expect(snapshot.tasks[0]?.status).toBe('completed');
    expect(snapshot.tasks[0]?.resultSummary).toBe('snapshot body');
    expect(snapshot.events.map((e) => e.type)).toContain('task.completed');
  });
});
