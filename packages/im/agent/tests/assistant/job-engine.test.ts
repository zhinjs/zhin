import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ScheduleJobEngine } from '../../src/assistant/job-engine.js';
import { ScheduleJobStore } from '../../src/assistant/job-store.js';
import { JobWorker } from '../../src/assistant/job-worker.js';
import type { TaskExecutor } from '../../src/task-executor.js';

describe('ScheduleJobEngine', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'zhin-schedule-engine-'));
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('addJob 持久化并在 every 调度触发时调用 worker', async () => {
    const executeTask = vi.fn(async () => ({
      success: true,
      responseText: 'ok',
      durationMs: 10,
    }));
    const executor = { executeTask } as unknown as TaskExecutor;
    const store = new ScheduleJobStore({ dataDir });
    const worker = new JobWorker({ executor });

    const engine = new ScheduleJobEngine({ store, worker });
    engine.load();

    await engine.addJob({
      id: 'sched-echo',
      enabled: true,
      schedule: { kind: 'every', everyMs: 1000 },
      action: { kind: 'agent', prompt: 'echo schedule' },
      notify: { channel: 'silent' },
    });

    const jobs = await engine.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.action.prompt).toBe('echo schedule');

    await vi.advanceTimersByTimeAsync(2_500);
    expect(executeTask).toHaveBeenCalled();

    const stored = await store.getJob('sched-echo');
    expect(stored?.state.lastStatus).toBe('ok');

    engine.unload();
  });
});
