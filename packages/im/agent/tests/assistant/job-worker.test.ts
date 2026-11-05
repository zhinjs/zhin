import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TimerScheduler } from '../../src/assistant/timer-scheduler.js';
import { ScheduleJobStore } from '../../src/assistant/job-store.js';
import { createNotificationRouter } from '../../src/assistant/notification-router.js';
import type { ScheduleJob } from '../../src/assistant/types.js';
import type { TaskExecutionResult, TaskExecutor } from '../../src/task-executor.js';

function scheduleJob(id: string): ScheduleJob {
  return {
    id,
    enabled: true,
    schedule: { kind: 'every', everyMs: 60_000 },
    action: { kind: 'agent', prompt: id },
    notify: { channel: 'silent' },
    createdAt: 1,
    updatedAt: 1,
    state: {},
  };
}

function createScheduler(executor: TaskExecutor, queue?: { maxConcurrency?: number; maxRetries?: number; defaultTimeoutMs?: number }, dataDir?: string) {
  const store = new ScheduleJobStore({ dataDir: dataDir! });
  const router = createNotificationRouter({ resolveAdapter: () => undefined });
  return new TimerScheduler({
    store,
    due: { run: (job, opts) => executor.execute(job, { signal: opts.signal, attempt: opts.attempt }) },
    router,
    ...(queue ? { queue } : {}),
  });
}

describe('TimerScheduler queue ownership', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'zhin-timer-queue-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('enforces one owned queue across concurrent runs', async () => {
    const releases: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    const execute = vi.fn(async (): Promise<TaskExecutionResult> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return {
        success: true,
        responseText: 'ok',
        output: 'ok',
        durationMs: 1,
        toolsUsed: [],
        tokenUsage: { input: 0, output: 0 },
      };
    });
    const scheduler = createScheduler(
      { execute } as TaskExecutor,
      { maxConcurrency: 1, maxRetries: 0, defaultTimeoutMs: 5_000 },
      dataDir,
    );

    const first = scheduler.deliver(scheduleJob('first'));
    const second = scheduler.deliver(scheduleJob('second'));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(maxActive).toBe(1);

    releases.shift()?.();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(maxActive).toBe(1);
    releases.shift()?.();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    await scheduler.stop();
    scheduler.unload();
  });

  it('uses the owned queue without an enable switch', async () => {
    const releases: Array<() => void> = [];
    const execute = vi.fn(async (): Promise<TaskExecutionResult> => {
      await new Promise<void>(resolve => releases.push(resolve));
      return {
        success: true,
        responseText: 'ok',
        output: 'ok',
        durationMs: 1,
        toolsUsed: [],
        tokenUsage: { input: 0, output: 0 },
      };
    });
    const scheduler = createScheduler({ execute } as TaskExecutor, undefined, dataDir);

    const runs = Array.from({ length: 4 }, (_, index) => scheduler.deliver(scheduleJob(String(index))));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
    releases.splice(0).forEach(release => release());
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(4));
    releases.splice(0).forEach(release => release());

    await expect(Promise.all(runs)).resolves.toHaveLength(4);
    await scheduler.stop();
    scheduler.unload();
  });

  it('settles running and queued runs when stopped', async () => {
    let operationSettled = false;
    const execute = vi.fn(async (_job: ScheduleJob, options?: { signal?: AbortSignal }): Promise<TaskExecutionResult> => {
      await new Promise<void>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          operationSettled = true;
          reject(options.signal?.reason);
        }, { once: true });
      });
      throw new Error('unreachable');
    });
    const scheduler = createScheduler(
      { execute } as TaskExecutor,
      { maxConcurrency: 1, maxRetries: 0, defaultTimeoutMs: 5_000 },
      dataDir,
    );

    const running = scheduler.deliver(scheduleJob('running'));
    const queued = scheduler.deliver(scheduleJob('queued'));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    const stopping = scheduler.stop();

    await expect(running).resolves.toMatchObject({ success: false });
    await expect(queued).resolves.toMatchObject({ success: false });
    await stopping;
    expect(operationSettled).toBe(true);
    scheduler.unload();
  });
});
