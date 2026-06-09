import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryOrchestrationRepository } from '../src/orchestrator/orchestration-repository.js';
import {
  OrchestrationService,
  MISSIONS_TEMPLATE,
  initOrchestrationService,
} from '../src/orchestrator/orchestration-service.js';
import { getAgentDispatcher } from '../src/orchestrator/agent-dispatcher.js';

describe('OrchestrationRepository + Service', () => {
  let repo: MemoryOrchestrationRepository;
  let service: OrchestrationService;

  beforeEach(() => {
    repo = new MemoryOrchestrationRepository();
    service = initOrchestrationService(repo);
    getAgentDispatcher().setRepository(repo);
  });

  it('creates run with missions template', async () => {
    const snapshot = await service.startRun({
      sessionKey: 'private:test',
      title: 'Feature X',
    });
    expect(snapshot.run.status).toBe('active');
    expect(snapshot.run.template).toBe(MISSIONS_TEMPLATE);
    expect(snapshot.tasks).toHaveLength(5);
    expect(snapshot.tasks.map((t) => t.phase)).toEqual([
      'plan', 'spec', 'develop', 'validate', 'negotiate',
    ]);
  });

  it('blocks develop when dependency not met', async () => {
    const snapshot = await service.startRun({ sessionKey: 'private:test' });
    const develop = snapshot.tasks.find((t) => t.phase === 'develop')!;
    const gate = await getAgentDispatcher().canExecuteMissions(develop.id);
    expect(gate.canExecute).toBe(false);
  });

  it('retry and skip failed task', async () => {
    const snapshot = await service.startRun({ sessionKey: 's1', title: 't' });
    const task = snapshot.tasks.find((t) => t.phase === 'plan')!;
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
