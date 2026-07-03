import { describe, it, expect, beforeEach } from 'vitest';
import { getAgentDispatcher } from '../src/orchestrator/agent-dispatcher.js';
import { MemoryOrchestrationRepository } from '../src/orchestrator/orchestration-repository.js';
import { initOrchestrationService } from '../src/orchestrator/orchestration-service.js';

describe('AgentDispatcher hard orchestration', () => {
  beforeEach(() => {
    const repo = new MemoryOrchestrationRepository();
    initOrchestrationService(repo);
    getAgentDispatcher().setRepository(repo);
  });

  it('failed dependency blocks downstream', async () => {
    const dispatcher = getAgentDispatcher();
    const repo = new MemoryOrchestrationRepository();
    dispatcher.setRepository(repo);
    const run = await repo.createRun({ session_key: 's' });
    const a = await repo.createTask({ run_id: run.id, name: 'a', role: 'planner' });
    const b = await repo.createTask({ run_id: run.id, name: 'b', role: 'subtask', depends_on: [a.id] });
    dispatcher.syncTaskFromRecord(a);
    dispatcher.syncTaskFromRecord(b);

    await repo.updateTaskStatus(a.id, 'failed', { error: 'x' });
    dispatcher.syncTaskFromRecord((await repo.getTask(a.id))!);

    const gate = dispatcher.canExecute(b.id);
    expect(gate.canExecute).toBe(false);
    expect(gate.reason).toContain('失败');
  });

  it('cancelled dependency unlocks downstream', async () => {
    const dispatcher = getAgentDispatcher();
    const repo = new MemoryOrchestrationRepository();
    dispatcher.setRepository(repo);
    const run = await repo.createRun({ session_key: 's' });
    const a = await repo.createTask({ run_id: run.id, name: 'a', role: 'planner' });
    const b = await repo.createTask({ run_id: run.id, name: 'b', role: 'subtask', depends_on: [a.id] });
    dispatcher.syncTaskFromRecord(a);
    dispatcher.syncTaskFromRecord(b);

    await repo.updateTaskStatus(a.id, 'cancelled', { error: 'cancelled' });
    dispatcher.syncTaskFromRecord((await repo.getTask(a.id))!);

    const gate = dispatcher.canExecute(b.id);
    expect(gate.canExecute).toBe(true);
  });
});
