import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryOrchestrationRepository } from '../src/orchestrator/orchestration-repository.js';
import { OrchestrationService, PLAN_DEV_REVIEW_TEMPLATE } from '../src/orchestrator/orchestration-service.js';
import { initOrchestrationService } from '../src/orchestrator/orchestration-service.js';
import { getAgentDispatcher } from '../src/orchestrator/agent-dispatcher.js';

describe('OrchestrationRepository + Service', () => {
  let repo: MemoryOrchestrationRepository;
  let service: OrchestrationService;

  beforeEach(() => {
    repo = new MemoryOrchestrationRepository();
    service = initOrchestrationService(repo);
    getAgentDispatcher().setRepository(repo);
  });

  it('creates run with plan-dev-review template', async () => {
    const snapshot = await service.startRun({
      sessionKey: 'private:test',
      title: 'Feature X',
      template: PLAN_DEV_REVIEW_TEMPLATE,
    });
    expect(snapshot.run.status).toBe('active');
    expect(snapshot.tasks).toHaveLength(3);
    expect(snapshot.tasks.map((t) => t.role)).toEqual(['planner', 'subtask', 'reviewer']);
  });

  it('blocks spawn when dependency not met', async () => {
    const snapshot = await service.startRun({
      sessionKey: 'private:test',
      template: PLAN_DEV_REVIEW_TEMPLATE,
    });
    const devTask = snapshot.tasks.find((t) => t.role === 'subtask')!;
    const gate = getAgentDispatcher().canExecute(devTask.id);
    expect(gate.canExecute).toBe(false);
    expect(gate.reason).toContain('依赖');
  });

  it('retry and skip failed task', async () => {
    const run = await service.startRun({ sessionKey: 's1', title: 't' });
    const task = await service.addTask({ runId: run.run.id, name: 'solo', role: 'subtask' });
    await repo.updateTaskStatus(task.id, 'failed', { error: 'boom' });
    getAgentDispatcher().syncTaskFromRecord((await repo.getTask(task.id))!);

    const retry = await service.retryTask(task.id);
    expect(retry.ok).toBe(true);
    const afterRetry = await repo.getTask(task.id);
    expect(afterRetry?.status).toBe('pending');

    await repo.updateTaskStatus(task.id, 'failed', { error: 'boom2' });
    const skip = await service.skipTask(task.id, 'not needed');
    expect(skip.ok).toBe(true);
    const afterSkip = await repo.getTask(task.id);
    expect(afterSkip?.status).toBe('skipped');
  });
});
