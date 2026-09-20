import { describe, expect, it } from 'vitest';
import {
  MAX_RESPAWNS_PER_MINUTE,
  planRespawn,
  processRestartExitCode,
} from '../../../src/plugin-runtime/start/process-supervisor.js';

describe('native TypeScript process supervisor', () => {
  it('respawns a requested restart and records the attempt', () => {
    const now = Date.now();
    const plan = planRespawn(processRestartExitCode, false, false, [], now);
    expect(plan).toEqual({ respawn: true, attempts: [now] });
    expect(Object.isFrozen(plan)).toBe(true);
  });

  it('does not respawn once mode or an ordinary foreground failure', () => {
    const now = Date.now();
    expect(planRespawn(processRestartExitCode, true, false, [], now).respawn).toBe(false);
    expect(planRespawn(0, false, false, [], now).respawn).toBe(false);
    expect(planRespawn(1, false, false, [], now).respawn).toBe(false);
    expect(planRespawn(null, false, false, [], now).respawn).toBe(false);
  });

  it('respawns daemon crashes within the storm budget', () => {
    const now = Date.now();
    let attempts: readonly number[] = [];
    for (let index = 0; index < MAX_RESPAWNS_PER_MINUTE; index += 1) {
      const plan = planRespawn(1, false, true, attempts, now + index * 1_000);
      expect(plan.respawn).toBe(true);
      attempts = plan.attempts;
    }
    expect(planRespawn(1, false, true, attempts, now + 60_000 - 1).respawn).toBe(false);
  });

  it('forgets attempts outside the rolling one-minute window', () => {
    const now = Date.now();
    const stale = Array.from(
      { length: MAX_RESPAWNS_PER_MINUTE },
      (_value, index) => now - 61_000 - index,
    );
    expect(planRespawn(processRestartExitCode, false, false, stale, now))
      .toEqual({ respawn: true, attempts: [now] });
  });
});
