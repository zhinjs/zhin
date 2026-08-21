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
    const execute = vi.fn(async () => ({
      success: true,
      responseText: 'ok',
      durationMs: 10,
    }));
    const executor = { execute } as unknown as TaskExecutor;
    const store = new ScheduleJobStore({ dataDir });
    const worker = new JobWorker({ executor });

    const engine = new ScheduleJobEngine({ store, worker });
    await engine.load();

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
    expect(execute).toHaveBeenCalled();
    expect(execute.mock.calls[0]?.[0]).toMatchObject({ id: 'sched-echo' });

    const stored = await store.getJob('sched-echo');
    expect(stored?.state.lastStatus).toBe('ok');

    engine.unload();
  });

  it('runJob passes createdBy to task executor', async () => {
    const execute = vi.fn(async () => ({
      success: true,
      responseText: 'ok',
      durationMs: 10,
    }));
    const executor = { execute } as unknown as TaskExecutor;
    const store = new ScheduleJobStore({ dataDir });
    const worker = new JobWorker({ executor });
    const engine = new ScheduleJobEngine({ store, worker });

    await engine.addJob({
      id: 'sched-owner',
      enabled: true,
      schedule: { kind: 'every', everyMs: 60_000 },
      action: { kind: 'agent', prompt: 'daily weather' },
      notify: { channel: 'silent' },
      createdBy: { userId: '1659488338', roles: ['master'], name: 'Owner' },
    });
    engine.registerOne((await store.getJob('sched-owner'))!);
    await engine.runJobNow('sched-owner');

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        createdBy: {
          userId: '1659488338',
          roles: ['master'],
          name: 'Owner',
        },
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    engine.unload();
  });

  it('runJob passes executionPlan and activityFeedback to task executor', async () => {
    const execute = vi.fn(async () => ({
      success: true,
      responseText: 'ok',
      durationMs: 10,
    }));
    const executor = { execute } as unknown as TaskExecutor;
    const store = new ScheduleJobStore({ dataDir });
    const worker = new JobWorker({ executor });
    const engine = new ScheduleJobEngine({ store, worker });

    await engine.addJob({
      id: 'sched-plan',
      enabled: true,
      schedule: { kind: 'every', everyMs: 60_000 },
      action: { kind: 'agent', prompt: 'daily weather' },
      notify: { channel: 'silent' },
      executionPlan: {
        prompt: 'refined weather',
        tools: ['web_search'],
        skills: ['weather'],
        confirmed: true,
      },
      activityFeedback: true,
    });
    await engine.runJobNow('sched-plan');

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        executionPlan: {
          prompt: 'refined weather',
          tools: ['web_search'],
          skills: ['weather'],
          confirmed: true,
        },
        activityFeedback: true,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    engine.unload();
  });
});
