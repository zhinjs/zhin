/**
 * Orchestration SSOT v1 — Executor × terminal state contract matrix.
 * Each executor kind must reach Kernel terminal states (not stuck waiting_result).
 */
import { describe, expect, it, vi } from 'vitest';
import { getAgentDispatcher } from '../../src/orchestrator/agent-dispatcher.js';
import { MemoryOrchestrationRepository } from '../../src/orchestrator/orchestration-repository.js';
import { initOrchestrationService } from '../../src/orchestrator/orchestration-service.js';
import type { AgentExecutor } from '../../src/orchestrator/orchestration-types.js';
import {
  executeRemoteOrchestrationTask,
  pollRemoteTaskStatus,
} from '../../src/orchestrator/remote-task-executor.js';
import {
  initRemoteAgentRegistry,
  type RemoteAgentRegistry,
} from '../../src/orchestrator/remote-agent-registry.js';

describe('Executor contract — local', () => {
  it('success: result event → completed + result_summary', async () => {
    const kernel = initOrchestrationService(new MemoryOrchestrationRepository());
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
    const kernel = initOrchestrationService(new MemoryOrchestrationRepository());
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
    const kernel = initOrchestrationService(repo);
    const run = await kernel.startRun({ sessionKey: 'local-cancel' });
    const task = await kernel.addTask({ runId: run.run.id, name: 'work' });
    await repo.updateTaskStatus(task.id, 'running', { started_at: Date.now() });

    const cancelled = await kernel.cancelTask(task.id, 'user cancelled');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.error).toContain('user cancelled');
  });
});

describe('Executor contract — scene_mention', () => {
  it('fail: error event → failed', async () => {
    const kernel = initOrchestrationService(new MemoryOrchestrationRepository());
    const run = await kernel.startRun({ sessionKey: 'mention-fail' });
    const dispatched = await kernel.dispatchTask({
      runId: run.run.id,
      name: '@peer',
      executorKind: 'scene_mention',
      assignedTo: 'peer-bot',
      autoStart: false,
    });

    const executor: AgentExecutor = {
      kind: 'scene_mention',
      async *execute() {
        yield { type: 'error', error: 'mention send failed' };
      },
    };

    const task = await kernel.runTask(dispatched.task.id, undefined, executor);
    expect(task.status).toBe('failed');
    expect(task.error).toContain('mention send failed');
  });

  it('handoff: no result event → waiting_result (completed via outbound bridge)', async () => {
    const kernel = initOrchestrationService(new MemoryOrchestrationRepository());
    const run = await kernel.startRun({ sessionKey: 'mention-wait' });
    const dispatched = await kernel.dispatchTask({
      runId: run.run.id,
      name: '@peer',
      executorKind: 'scene_mention',
      assignedTo: 'peer-bot',
      autoStart: false,
    });

    const executor: AgentExecutor = {
      kind: 'scene_mention',
      async *execute() {
        yield { type: 'progress', text: 'waiting_result from peer-bot' };
      },
    };

    const task = await kernel.runTask(dispatched.task.id, undefined, executor);
    expect(task.status).toBe('waiting_result');

    await kernel.completeTask(task.id, 'peer replied in group');
    const completed = await kernel.repository.getTask(task.id);
    expect(completed?.status).toBe('completed');
    expect(completed?.result_summary).toBe('peer replied in group');
  });
});

describe('Executor contract — remote_mesh', () => {
  beforeEach(() => {
    initRemoteAgentRegistry({
      remoteAgents: [{ id: 'local', url: 'http://127.0.0.1:8068/mcp', token: 't' }],
    });
  });

  it('success: delegate → poll completed', async () => {
    const repo = new MemoryOrchestrationRepository();
    initOrchestrationService(repo);
    getAgentDispatcher().setRepository(repo);

    const run = await repo.createRun({ session_key: 'remote-ok', title: 'r' });
    const task = await repo.createTask({
      run_id: run.id,
      name: 'Remote',
      role: 'subtask',
      executor_kind: 'remote_mesh',
      remote_agent_id: 'local',
      status: 'running',
    });
    getAgentDispatcher().syncTaskFromRecord(task);

    const remoteTaskId = 'rt-1';
    const registry = initRemoteAgentRegistry({
      remoteAgents: [{ id: 'local', url: 'http://127.0.0.1:8068/mcp', token: 't' }],
    });
    const callTool = vi.fn()
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({ remote_task_id: remoteTaskId }) }],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({ status: 'completed' }) }],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'remote result text' }],
      });
    vi.spyOn(registry, 'getConnection').mockResolvedValue({
      callTool,
      isConnected: true,
      connect: vi.fn(),
    } as unknown as Awaited<ReturnType<RemoteAgentRegistry['getConnection']>>);

    expect((await executeRemoteOrchestrationTask(task.id)).ok).toBe(true);
    const poll = await pollRemoteTaskStatus(task.id);
    expect(poll.done).toBe(true);
    expect(poll.status).toBe('completed');

    const updated = await repo.getTask(task.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.result_summary).toContain('remote result');
  });

  it('fail: delegate throws → failed (not waiting_result)', async () => {
    const repo = new MemoryOrchestrationRepository();
    initOrchestrationService(repo);
    getAgentDispatcher().setRepository(repo);

    const run = await repo.createRun({ session_key: 'remote-fail', title: 'r' });
    const task = await repo.createTask({
      run_id: run.id,
      name: 'Remote',
      role: 'subtask',
      executor_kind: 'remote_mesh',
      remote_agent_id: 'local',
      status: 'running',
    });
    getAgentDispatcher().syncTaskFromRecord(task);

    const registry = initRemoteAgentRegistry({
      remoteAgents: [{ id: 'local', url: 'http://127.0.0.1:8068/mcp', token: 't' }],
    });
    vi.spyOn(registry, 'getConnection').mockResolvedValue({
      callTool: vi.fn().mockRejectedValue(new Error('delegate boom')),
      isConnected: true,
      connect: vi.fn(),
    } as unknown as Awaited<ReturnType<RemoteAgentRegistry['getConnection']>>);

    expect((await executeRemoteOrchestrationTask(task.id)).ok).toBe(false);
    const updated = await repo.getTask(task.id);
    expect(updated?.status).toBe('failed');
  });

  it('cancel: remote cancelled status → cancelled terminal', async () => {
    const repo = new MemoryOrchestrationRepository();
    initOrchestrationService(repo);
    getAgentDispatcher().setRepository(repo);

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
    getAgentDispatcher().syncTaskFromRecord(synced);

    const registry = initRemoteAgentRegistry({
      remoteAgents: [{ id: 'local', url: 'http://127.0.0.1:8068/mcp', token: 't' }],
    });
    vi.spyOn(registry, 'getConnection').mockResolvedValue({
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({ status: 'cancelled' }) }],
      }),
      isConnected: true,
      connect: vi.fn(),
    } as unknown as Awaited<ReturnType<RemoteAgentRegistry['getConnection']>>);

    const poll = await pollRemoteTaskStatus(task.id);
    expect(poll.done).toBe(true);
    expect(poll.status).toBe('cancelled');

    const updated = await repo.getTask(task.id);
    expect(updated?.status).toBe('cancelled');
  });
});

describe('Executor contract — snapshot API', () => {
  it('getSnapshot reflects kernel DB after completeTask', async () => {
    const kernel = initOrchestrationService(new MemoryOrchestrationRepository());
    const run = await kernel.startRun({ sessionKey: 'snap' });
    const task = await kernel.addTask({ runId: run.run.id, name: 't1' });
    await kernel.completeTask(task.id, 'snapshot body');

    const snapshot = await kernel.getSnapshot(run.run.id);
    expect(snapshot.tasks[0]?.status).toBe('completed');
    expect(snapshot.tasks[0]?.resultSummary).toBe('snapshot body');
    expect(snapshot.events.map((e) => e.type)).toContain('task.completed');
  });
});
