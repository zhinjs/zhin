/**
 * MissionRunner — auto advance with mocked SubagentManager.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryOrchestrationRepository } from '../src/orchestrator/orchestration-repository.js';
import {
  initOrchestrationService,
  MISSIONS_TEMPLATE,
} from '../src/orchestrator/orchestration-service.js';
import {
  getAgentDispatcher,
} from '../src/orchestrator/agent-dispatcher.js';
import {
  MissionRunner,
  initMissionRunner,
  getMissionRunner,
} from '../src/orchestrator/mission-runner.js';
import type { SubagentManager } from '../src/subagent.js';

describe('MissionRunner auto advance', () => {
  beforeEach(() => {
    getMissionRunner()?.stop();
  });

  it('spawns first pending task on advanceRun', async () => {
    const repo = new MemoryOrchestrationRepository();
    initOrchestrationService(repo);
    getAgentDispatcher().setRepository(repo);

    const snapshot = await initOrchestrationService(repo).startRun({
      sessionKey: 'sandbox:bot:private:user1',
      template: MISSIONS_TEMPLATE,
    });

    const spawn = vi.fn().mockResolvedValue('spawned');
    const manager = { spawn } as unknown as SubagentManager;

    const runner = new MissionRunner({
      subagentManager: manager,
      resolveSessionContext: () => null,
    });

    await runner.advanceRun(snapshot.run.id);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0]?.[0]?.orchestrationTaskId).toBe(
      snapshot.tasks.find((t) => t.phase === 'plan')!.id,
    );
  });

  it('initMissionRunner registers result listener', async () => {
    const repo = new MemoryOrchestrationRepository();
    initOrchestrationService(repo);
    getAgentDispatcher().setRepository(repo);

    const spawn = vi.fn().mockResolvedValue('ok');
    initMissionRunner({
      subagentManager: { spawn } as unknown as SubagentManager,
      resolveSessionContext: () => null,
    });

    const snapshot = await initOrchestrationService(repo).startRun({
      sessionKey: 'sandbox:bot:private:user1',
      template: MISSIONS_TEMPLATE,
    });
    const plan = snapshot.tasks.find((t) => t.phase === 'plan')!;

    getAgentDispatcher().recordResult({
      taskId: plan.id,
      role: 'planner',
      success: true,
      summary: 'plan done',
      duration: 1,
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(spawn.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
