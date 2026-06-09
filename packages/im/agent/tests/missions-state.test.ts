/**
 * Mission state repository patch API.
 */
import { describe, it, expect } from 'vitest';
import { MemoryOrchestrationRepository } from '../src/orchestrator/orchestration-repository.js';

describe('Mission state repository', () => {
  it('patchMissionState merges and increments version', async () => {
    const repo = new MemoryOrchestrationRepository();
    const run = await repo.createRun({
      session_key: 'sandbox:b:private:u',
      template: 'missions',
    });

    const initial = await repo.getMissionState(run.id);
    expect(initial?.phase).toBe('plan');

    const next = await repo.patchMissionState(run.id, {
      phase: 'spec',
      validation_spec_paths: ['a.test.ts'],
      assertion_count: 1,
    });
    expect(next?.phase).toBe('spec');
    expect(next?.validation_spec_paths).toEqual(['a.test.ts']);

    const stored = await repo.getRun(run.id);
    expect(stored?.state_version).toBe(1);
  });
});
