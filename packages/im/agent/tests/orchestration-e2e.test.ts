/**
 * L4 orchestration E2E contract — plan-dev-review DAG gate → complete.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryOrchestrationRepository } from '../src/orchestrator/orchestration-repository.js';
import {
  OrchestrationService,
  PLAN_DEV_REVIEW_TEMPLATE,
  initOrchestrationService,
} from '../src/orchestrator/orchestration-service.js';
import { getAgentDispatcher } from '../src/orchestrator/agent-dispatcher.js';

async function completeTask(
  repo: MemoryOrchestrationRepository,
  taskId: string,
): Promise<void> {
  await repo.updateTaskStatus(taskId, 'completed', {
    result_summary: 'done',
    finished_at: Date.now(),
  });
  const updated = await repo.getTask(taskId);
  if (updated) getAgentDispatcher().syncTaskFromRecord(updated);
}

describe('Orchestration plan-dev-review E2E', () => {
  let repo: MemoryOrchestrationRepository;
  let service: OrchestrationService;

  beforeEach(() => {
    repo = new MemoryOrchestrationRepository();
    service = initOrchestrationService(repo);
    getAgentDispatcher().setRepository(repo);
  });

  it('plan-dev-review: dependency gate → unlock → complete run', async () => {
    const snapshot = await service.startRun({
      sessionKey: 'private:l4',
      title: 'L4 feature',
      template: PLAN_DEV_REVIEW_TEMPLATE,
    });
    const runId = snapshot.run.id;
    const planner = snapshot.tasks.find((t) => t.role === 'planner')!;
    const dev = snapshot.tasks.find((t) => t.role === 'subtask')!;
    const review = snapshot.tasks.find((t) => t.role === 'reviewer')!;

    expect(getAgentDispatcher().canExecute(dev.id).canExecute).toBe(false);
    expect(getAgentDispatcher().canExecute(review.id).canExecute).toBe(false);

    await completeTask(repo, planner.id);
    expect(getAgentDispatcher().canExecute(dev.id).canExecute).toBe(true);
    expect(getAgentDispatcher().canExecute(review.id).canExecute).toBe(false);

    await completeTask(repo, dev.id);
    expect(getAgentDispatcher().canExecute(review.id).canExecute).toBe(true);

    await completeTask(repo, review.id);
    const close = await service.completeRun(runId);
    expect(close.ok).toBe(true);

    const final = await service.getStatus(runId);
    expect(final?.run.status).toBe('completed');
    expect(final?.tasks.every((t) => t.status === 'completed')).toBe(true);
  });

  it('retry failed task then complete downstream', async () => {
    const snapshot = await service.startRun({
      sessionKey: 'private:l4',
      template: PLAN_DEV_REVIEW_TEMPLATE,
    });
    const planner = snapshot.tasks.find((t) => t.role === 'planner')!;
    const dev = snapshot.tasks.find((t) => t.role === 'subtask')!;

    await completeTask(repo, planner.id);
    await repo.updateTaskStatus(dev.id, 'failed', { error: 'build failed' });
    getAgentDispatcher().syncTaskFromRecord((await repo.getTask(dev.id))!);

    const retry = await service.retryTask(dev.id);
    expect(retry.ok).toBe(true);
    expect(getAgentDispatcher().canExecute(dev.id).canExecute).toBe(true);

    await completeTask(repo, dev.id);
    const review = snapshot.tasks.find((t) => t.role === 'reviewer')!;
    expect(getAgentDispatcher().canExecute(review.id).canExecute).toBe(true);
  });
});
