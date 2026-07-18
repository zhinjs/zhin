import { describe, expect, it } from 'vitest';
import {
  MAX_RESPAWNS_PER_MINUTE,
  planRespawn,
  processRestartExitCode,
} from '../../src/plugin-runtime/start-command.js';

describe('native TypeScript relaunch respawn (exit 75)', () => {
  it('respawns on exit 75 in non-once mode and records the attempt', () => {
    const now = Date.now();
    const plan = planRespawn(processRestartExitCode, false, false, [], now);
    expect(plan.respawn).toBe(true);
    expect(plan.attempts).toEqual([now]);
  });

  it('never respawns in once mode', () => {
    const plan = planRespawn(processRestartExitCode, true, false, [], Date.now());
    expect(plan.respawn).toBe(false);
  });

  it('does not respawn for ordinary exit codes', () => {
    const now = Date.now();
    expect(planRespawn(0, false, false, [], now).respawn).toBe(false);
    expect(planRespawn(1, false, false, [], now).respawn).toBe(false);
    expect(planRespawn(null, false, false, [], now).respawn).toBe(false);
  });

  it('stops respawning once the per-minute storm budget is exhausted', () => {
    const now = Date.now();
    let attempts: readonly number[] = [];
    for (let index = 0; index < MAX_RESPAWNS_PER_MINUTE; index += 1) {
      const plan = planRespawn(processRestartExitCode, false, false, attempts, now + index * 1_000);
      expect(plan.respawn).toBe(true);
      attempts = plan.attempts;
    }
    const denied = planRespawn(processRestartExitCode, false, false, attempts, now + 60_000 - 1);
    expect(denied.respawn).toBe(false);
  });

  it('forgets attempts older than the one-minute window', () => {
    const now = Date.now();
    const stale = Array.from(
      { length: MAX_RESPAWNS_PER_MINUTE },
      (_value, index) => now - 61_000 - index,
    );
    const plan = planRespawn(processRestartExitCode, false, false, stale, now);
    expect(plan.respawn).toBe(true);
    expect(plan.attempts).toEqual([now]);
  });

  it('daemon mode respawns on crash exits', () => {
    const now = Date.now();
    expect(planRespawn(1, false, true, [], now).respawn).toBe(true);
    expect(planRespawn(1, false, false, [], now).respawn).toBe(false);
    expect(planRespawn(0, false, true, [], now).respawn).toBe(false);
    expect(planRespawn(1, true, true, [], now).respawn).toBe(false);
  });
});
