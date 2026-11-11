import { describe, expect, it } from 'vitest';
import {
  supervisorOrphanReason,
  MAX_RESPAWNS_PER_MINUTE,
  planRespawn,
  processRestartExitCode,
  processRestartSupported,
  supervisedNodeArguments,
} from '../../../src/plugin-runtime/start/process-supervisor.js';

describe('processRestartSupported (#1051 F1)', () => {
  it('is true only when the supervisor that stamped ZHIN_SUPERVISOR_PID is our parent, and not with --once', () => {
    expect(processRestartSupported(false, { ZHIN_SUPERVISOR_PID: '4242' }, 4242)).toBe(true);
    expect(processRestartSupported(true, { ZHIN_SUPERVISOR_PID: '4242' }, 4242)).toBe(false);
  });

  it('rejects a missing, empty or non-decimal pid', () => {
    for (const value of [undefined, '', ' ', 'abc', '0', '-1', '00', '042', '4242 ', ' 4242', '42.0', '4.2e3', '0x10', '+42', '1e3', 'Infinity']) {
      const environment = value === undefined ? {} : { ZHIN_SUPERVISOR_PID: value };
      expect(processRestartSupported(false, environment, 4242), JSON.stringify(value)).toBe(false);
    }
  });

  it('does not trust an inherited / image-level pid that is not our parent (e.g. Dockerfile ZHIN_SUPERVISOR_PID=1)', () => {
    expect(processRestartSupported(false, { ZHIN_SUPERVISOR_PID: '1' }, 4242)).toBe(false);
    expect(processRestartSupported(false, { ZHIN_SUPERVISOR_PID: '4242' }, 1)).toBe(false);
    // 守护进程本身就是容器 PID 1 时，pid=1 与父进程一致，仍然可信。
    expect(processRestartSupported(false, { ZHIN_SUPERVISOR_PID: '1' }, 1)).toBe(true);
    expect(processRestartSupported(true, { ZHIN_SUPERVISOR_PID: '1' }, 1)).toBe(false);
  });

  it('defaults to the current process environment and parent pid', () => {
    const previous = process.env.ZHIN_SUPERVISOR_PID;
    try {
      process.env.ZHIN_SUPERVISOR_PID = String(process.ppid);
      expect(processRestartSupported(false)).toBe(true);
      process.env.ZHIN_SUPERVISOR_PID = '1';
      expect(processRestartSupported(false)).toBe(process.ppid === 1);
    } finally {
      if (previous === undefined) delete process.env.ZHIN_SUPERVISOR_PID;
      else process.env.ZHIN_SUPERVISOR_PID = previous;
    }
  });
});

describe('native TypeScript process supervisor', () => {
  it('preserves configured Node loaders in supervised and daemon children', () => {
    expect(supervisedNodeArguments([
      '--import', 'tsx',
      '--conditions=development',
      '--inspect=9229',
      '--experimental-loader=./custom-loader.mjs',
    ])).toEqual([
      '--import', 'tsx',
      '--conditions=development',
      '--experimental-loader=./custom-loader.mjs',
      '--experimental-strip-types',
      '--disable-warning=ExperimentalWarning',
    ]);
  });

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

describe('supervisorOrphanReason', () => {
  const esrch = () => { throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' }); };
  const eperm = () => { throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' }); };

  it('never reports an orphan without an explicit supervisor pid, even when the parent is init', () => {
    // ppid is irrelevant by design: systemd- and container-started bots have ppid 1.
    expect(supervisorOrphanReason({}, esrch)).toBeUndefined();
    expect(supervisorOrphanReason({ ZHIN_SUPERVISOR_PID: '' }, esrch)).toBeUndefined();
    expect(supervisorOrphanReason({ ZHIN_SUPERVISOR_PID: 'abc' }, esrch)).toBeUndefined();
  });

  it('reports an orphan only when the stamped supervisor no longer exists', () => {
    expect(supervisorOrphanReason({ ZHIN_SUPERVISOR_PID: '4242' }, () => undefined)).toBeUndefined();
    expect(supervisorOrphanReason({ ZHIN_SUPERVISOR_PID: '4242' }, esrch)).toBe('supervisor 4242 exited');
  });

  it('treats EPERM as alive (a supervisor owned by another user, e.g. PID 1)', () => {
    expect(supervisorOrphanReason({ ZHIN_SUPERVISOR_PID: '1' }, eperm)).toBeUndefined();
  });

  it('probes the real process table by default', () => {
    expect(supervisorOrphanReason({ ZHIN_SUPERVISOR_PID: String(process.pid) })).toBeUndefined();
  });
});
