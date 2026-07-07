/**
 * L4 loopback remoteAgents — delegate_task → query_status → get_result (mocked MCP).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
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

describe('Remote loopback delegate flow', () => {
  let repo: MemoryOrchestrationRepository;

  beforeEach(() => {
    repo = new MemoryOrchestrationRepository();
    initOrchestrationService(repo);
    getAgentDispatcher().setRepository(repo);
    initRemoteAgentRegistry({
      remoteAgents: [{
        id: 'local',
        url: 'http://127.0.0.1:8068/mcp',
        token: 'test-token',
      }],
    });
  });

  it('delegate → poll completed via mocked MCP connection', async () => {
    const run = await repo.createRun({ session_key: 's1', title: 'remote task' });
    const task = await repo.createTask({
      run_id: run.id,
      name: 'Remote work',
      role: 'subtask',
      executor_kind: 'remote_mesh',
      remote_agent_id: 'local',
    });
    getAgentDispatcher().syncTaskFromRecord(task);

    const remoteTaskId = 'rt-abc123';
    const callTool = vi.fn()
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({ remote_task_id: remoteTaskId }) }],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({ status: 'running' }) }],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({ status: 'completed' }) }],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Task finished successfully' }],
      });

    const registry = initRemoteAgentRegistry({
      remoteAgents: [{ id: 'local', url: 'http://127.0.0.1:8068/mcp', token: 't' }],
    });
    vi.spyOn(registry, 'getConnection').mockResolvedValue({
      callTool,
      isConnected: true,
      connect: vi.fn(),
    } as unknown as Awaited<ReturnType<RemoteAgentRegistry['getConnection']>>);

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
    expect(callTool).toHaveBeenCalledWith('agent.delegate_task', expect.any(Object));
    expect(callTool).toHaveBeenCalledWith('agent.query_status', { task_id: remoteTaskId });
    expect(callTool).toHaveBeenCalledWith('agent.get_result', { task_id: remoteTaskId });
  });

  it('marks kernel task failed when remote delegate_task throws', async () => {
    const run = await repo.createRun({ session_key: 's2', title: 'remote fail' });
    const task = await repo.createTask({
      run_id: run.id,
      name: 'Remote work',
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
      callTool: vi.fn().mockRejectedValue(new Error('MCP unavailable')),
      isConnected: true,
      connect: vi.fn(),
    } as unknown as Awaited<ReturnType<RemoteAgentRegistry['getConnection']>>);

    const delegate = await executeRemoteOrchestrationTask(task.id);
    expect(delegate.ok).toBe(false);

    const updated = await repo.getTask(task.id);
    expect(updated?.status).toBe('failed');
    expect(updated?.error).toContain('MCP unavailable');
  });
});
