/**
 * missions template E2E — DAG structure + mission state init.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryOrchestrationRepository } from '../src/orchestrator/orchestration-repository.js';
import {
  OrchestrationService,
  MISSIONS_TEMPLATE,
  initOrchestrationService,
} from '../src/orchestrator/orchestration-service.js';
import { getAgentDispatcher } from '../src/orchestrator/agent-dispatcher.js';

describe('Missions template', () => {
  let repo: MemoryOrchestrationRepository;
  let service: OrchestrationService;

  beforeEach(() => {
    repo = new MemoryOrchestrationRepository();
    service = initOrchestrationService(repo);
    getAgentDispatcher().setRepository(repo);
  });

  it('creates five-phase DAG with mission state', async () => {
    const snapshot = await service.startRun({
      sessionKey: 'private:l4',
      title: 'Missions feature',
    });

    expect(snapshot.run.template).toBe(MISSIONS_TEMPLATE);
    expect(snapshot.tasks.map((t) => t.phase)).toEqual([
      'plan', 'spec', 'develop', 'validate', 'negotiate',
    ]);
    expect(snapshot.tasks.find((t) => t.phase === 'develop')?.is_writer).toBe(1);
    expect(snapshot.tasks.find((t) => t.role === 'validator')).toBeTruthy();

    const state = await service.getMissionState(snapshot.run.id);
    expect(state?.phase).toBe('plan');
    expect(state?.validation_spec_paths).toEqual([]);
  });

  it('plan completes unlocks spec only (develop still gated)', async () => {
    const snapshot = await service.startRun({ sessionKey: 'private:l4' });
    const plan = snapshot.tasks.find((t) => t.phase === 'plan')!;
    const spec = snapshot.tasks.find((t) => t.phase === 'spec')!;
    const develop = snapshot.tasks.find((t) => t.phase === 'develop')!;

    await repo.updateTaskStatus(plan.id, 'completed', { finished_at: Date.now() });
    getAgentDispatcher().syncTaskFromRecord((await repo.getTask(plan.id))!);

    expect(getAgentDispatcher().canExecute(spec.id).canExecute).toBe(true);
    expect((await getAgentDispatcher().canExecuteMissions(develop.id)).canExecute).toBe(false);
  });
});
