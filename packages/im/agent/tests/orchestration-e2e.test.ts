/**
 * L4 orchestration E2E — missions DAG gate → retry → complete.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryOrchestrationRepository } from '../src/orchestrator/orchestration-repository.js';
import {
  OrchestrationService,
  MISSIONS_TEMPLATE,
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

describe('Orchestration missions E2E', () => {
  let repo: MemoryOrchestrationRepository;
  let service: OrchestrationService;

  beforeEach(() => {
    repo = new MemoryOrchestrationRepository();
    service = initOrchestrationService(repo);
    getAgentDispatcher().setRepository(repo);
  });

  it('missions: dependency gate on develop until spec gate', async () => {
    const snapshot = await service.startRun({
      sessionKey: 'private:l4',
      title: 'L4 feature',
    });
    expect(snapshot.run.template).toBe(MISSIONS_TEMPLATE);

    const plan = snapshot.tasks.find((t) => t.phase === 'plan')!;
    const spec = snapshot.tasks.find((t) => t.phase === 'spec')!;
    const develop = snapshot.tasks.find((t) => t.phase === 'develop')!;

    expect(getAgentDispatcher().canExecute(spec.id).canExecute).toBe(false);
    expect((await getAgentDispatcher().canExecuteMissions(develop.id)).canExecute).toBe(false);

    await completeTask(repo, plan.id);
    expect(getAgentDispatcher().canExecute(spec.id).canExecute).toBe(true);
    expect((await getAgentDispatcher().canExecuteMissions(develop.id)).canExecute).toBe(false);
  });

  it('retry failed task then unlock downstream', async () => {
    const snapshot = await service.startRun({ sessionKey: 'private:l4' });
    const plan = snapshot.tasks.find((t) => t.phase === 'plan')!;
    const spec = snapshot.tasks.find((t) => t.phase === 'spec')!;

    await completeTask(repo, plan.id);
    await repo.updateTaskStatus(spec.id, 'failed', { error: 'spec failed' });
    getAgentDispatcher().syncTaskFromRecord((await repo.getTask(spec.id))!);

    const retry = await service.retryTask(spec.id);
    expect(retry.ok).toBe(true);
    expect(getAgentDispatcher().canExecute(spec.id).canExecute).toBe(true);
  });
});
