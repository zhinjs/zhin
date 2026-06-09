/**
 * Mission negotiation — validate failure retry / skip negotiate on success.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryOrchestrationRepository } from '../src/orchestrator/orchestration-repository.js';
import {
  initOrchestrationService,
  MISSIONS_TEMPLATE,
} from '../src/orchestrator/orchestration-service.js';
import {
  evaluateMissionNegotiation,
} from '../src/orchestrator/mission-negotiation.js';

describe('Mission negotiation', () => {
  beforeEach(() => {
    initOrchestrationService(new MemoryOrchestrationRepository());
  });

  it('validate success skips negotiate', async () => {
    const repo = new MemoryOrchestrationRepository();
    const service = initOrchestrationService(repo);
    const snapshot = await service.startRun({
      sessionKey: 'private:t',
      template: MISSIONS_TEMPLATE,
    });
    const validate = snapshot.tasks.find((t) => t.phase === 'validate')!;
    const outcome = await evaluateMissionNegotiation(
      service,
      snapshot.run.id,
      validate,
      { taskId: validate.id, role: 'validator', success: true, summary: 'ok', duration: 0 },
      snapshot.tasks,
    );
    expect(outcome.action).toBe('skip_negotiate');
    expect(outcome.skipTaskIds?.length).toBe(1);
  });

  it('validate failure decrements retry budget', async () => {
    const repo = new MemoryOrchestrationRepository();
    const service = initOrchestrationService(repo);
    const snapshot = await service.startRun({
      sessionKey: 'private:t',
      template: MISSIONS_TEMPLATE,
    });
    await service.patchMissionState(snapshot.run.id, {
      retry_budget: { dev: 3, validate: 2 },
    }, { skipAcl: true });
    const validate = snapshot.tasks.find((t) => t.phase === 'validate')!;
    const outcome = await evaluateMissionNegotiation(
      service,
      snapshot.run.id,
      validate,
      { taskId: validate.id, role: 'validator', success: false, summary: 'fail', duration: 0 },
      snapshot.tasks,
    );
    expect(outcome.action).toBe('retry_dev');
    expect(outcome.statePatch?.retry_budget?.validate).toBe(1);
  });
});
