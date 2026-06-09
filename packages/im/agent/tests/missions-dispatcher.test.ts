/**
 * Missions dispatcher gates — writer mutex, validator tools, spec gate.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryOrchestrationRepository } from '../src/orchestrator/orchestration-repository.js';
import {
  initOrchestrationService,
  MISSIONS_TEMPLATE,
} from '../src/orchestrator/orchestration-service.js';
import {
  getAgentDispatcher,
  AGENT_ROLE_CONFIGS,
} from '../src/orchestrator/agent-dispatcher.js';
import { missionSpecGateSatisfied } from '../src/orchestrator/mission-state.js';

describe('Missions dispatcher gates', () => {
  beforeEach(() => {
    const repo = new MemoryOrchestrationRepository();
    initOrchestrationService(repo);
    getAgentDispatcher().setRepository(repo);
  });

  it('validator role blocks read_file and allows run_validation_spec', () => {
    const cfg = AGENT_ROLE_CONFIGS.validator;
    expect(cfg.blockedTools).toContain('read_file');
    expect(cfg.allowedTools).toContain('run_validation_spec');
  });

  it('writer mutex blocks second writer while first is running', async () => {
    const repo = new MemoryOrchestrationRepository();
    const service = initOrchestrationService(repo);
    getAgentDispatcher().setRepository(repo);

    const snapshot = await service.startRun({
      sessionKey: 'private:test',
      template: MISSIONS_TEMPLATE,
    });
    const writers = snapshot.tasks.filter((t) => t.is_writer === 1);
    expect(writers.length).toBeGreaterThanOrEqual(1);

    const w1 = writers[0]!;
    getAgentDispatcher().markRunning(w1.id, Promise.resolve({
      taskId: w1.id,
      role: 'subtask',
      success: true,
      summary: 'running',
      duration: 0,
    }));

    if (writers[1]) {
      const gate = getAgentDispatcher().canExecute(writers[1].id);
      expect(gate.canExecute).toBe(false);
      expect(gate.reason).toMatch(/Writer/);
    }
  });

  it('develop task blocked when spec gate not satisfied', async () => {
    const repo = new MemoryOrchestrationRepository();
    const service = initOrchestrationService(repo);
    getAgentDispatcher().setRepository(repo);

    const snapshot = await service.startRun({
      sessionKey: 'private:test',
      template: MISSIONS_TEMPLATE,
    });
    const plan = snapshot.tasks.find((t) => t.phase === 'plan')!;
    const writeSpec = snapshot.tasks.find((t) => t.phase === 'spec')!;
    const develop = snapshot.tasks.find((t) => t.phase === 'develop')!;

    await repo.updateTaskStatus(plan.id, 'completed', { finished_at: Date.now() });
    getAgentDispatcher().syncTaskFromRecord((await repo.getTask(plan.id))!);
    await repo.updateTaskStatus(writeSpec.id, 'completed', { finished_at: Date.now() });
    getAgentDispatcher().syncTaskFromRecord((await repo.getTask(writeSpec.id))!);

    const gate = await getAgentDispatcher().canExecuteMissions(develop.id);
    expect(gate.canExecute).toBe(false);
    expect(gate.reason).toMatch(/Spec/);

    await service.patchMissionState(snapshot.run.id, { phase: 'spec' }, { skipAcl: true });
    await service.patchMissionState(snapshot.run.id, {
      validation_spec_paths: ['.zhin/missions/x/spec.test.ts'],
      spec_dry_run_passed: true,
      assertion_count: 3,
    });

    const gate2 = await getAgentDispatcher().canExecuteMissions(develop.id);
    expect(gate2.canExecute).toBe(true);
  });

  it('missionSpecGateSatisfied requires all fields', () => {
    expect(missionSpecGateSatisfied({
      phase: 'develop',
      validation_spec_paths: ['a.test.ts'],
      spec_dry_run_passed: true,
      assertion_count: 1,
      decision_log: [],
      retry_budget: { dev: 3, validate: 3 },
    })).toBe(true);
    expect(missionSpecGateSatisfied({
      phase: 'develop',
      validation_spec_paths: [],
      decision_log: [],
      retry_budget: { dev: 3, validate: 3 },
    })).toBe(false);
  });
});
