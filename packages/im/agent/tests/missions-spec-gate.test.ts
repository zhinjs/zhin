/**
 * Mission spec gate — develop blocked until validation spec ready.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryOrchestrationRepository } from '../src/orchestrator/orchestration-repository.js';
import {
  initOrchestrationService,
  MISSIONS_TEMPLATE,
} from '../src/orchestrator/orchestration-service.js';
import { getAgentDispatcher } from '../src/orchestrator/agent-dispatcher.js';

describe('Mission spec gate', () => {
  beforeEach(() => {
    initOrchestrationService(new MemoryOrchestrationRepository());
  });

  it('develop stays blocked without spec_dry_run_passed', async () => {
    const repo = new MemoryOrchestrationRepository();
    const service = initOrchestrationService(repo);
    getAgentDispatcher().setRepository(repo);

    const snapshot = await service.startRun({
      sessionKey: 'sandbox:bot:private:user1',
      template: MISSIONS_TEMPLATE,
    });
    const plan = snapshot.tasks.find((t) => t.phase === 'plan')!;
    const spec = snapshot.tasks.find((t) => t.phase === 'spec')!;
    const develop = snapshot.tasks.find((t) => t.phase === 'develop')!;

    for (const id of [plan.id, spec.id]) {
      await repo.updateTaskStatus(id, 'completed', { finished_at: Date.now() });
      getAgentDispatcher().syncTaskFromRecord((await repo.getTask(id))!);
    }

    await service.patchMissionState(snapshot.run.id, { phase: 'spec' }, { skipAcl: true });
    await service.patchMissionState(snapshot.run.id, {
      validation_spec_paths: ['.zhin/missions/x/spec.test.ts'],
      assertion_count: 2,
    });

    const gate = await getAgentDispatcher().canExecuteMissions(develop.id);
    expect(gate.canExecute).toBe(false);

    await service.patchMissionState(snapshot.run.id, { spec_dry_run_passed: true });
    const gate2 = await getAgentDispatcher().canExecuteMissions(develop.id);
    expect(gate2.canExecute).toBe(true);
  });
});
