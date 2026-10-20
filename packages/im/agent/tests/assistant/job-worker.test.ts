import { describe, expect, it, vi } from 'vitest';
import { JobWorker } from '../../src/assistant/job-worker.js';
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

describe('JobWorker queue ownership', () => {
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
    const worker = new JobWorker({
      executor: { execute } as TaskExecutor,
      queue: { maxConcurrency: 1, maxRetries: 0, defaultTimeoutMs: 5_000 },
    });

    const first = worker.run(scheduleJob('first'));
    const second = worker.run(scheduleJob('second'));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(maxActive).toBe(1);

    releases.shift()?.();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(maxActive).toBe(1);
    releases.shift()?.();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    await worker.stop();
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
    const worker = new JobWorker({ executor: { execute } as TaskExecutor });

    const runs = Array.from({ length: 4 }, (_, index) => worker.run(scheduleJob(String(index))));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
    releases.splice(0).forEach(release => release());
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(4));
    releases.splice(0).forEach(release => release());

    await expect(Promise.all(runs)).resolves.toHaveLength(4);
    await worker.stop();
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
    const worker = new JobWorker({
      executor: { execute } as TaskExecutor,
      queue: { maxConcurrency: 1, maxRetries: 0, defaultTimeoutMs: 5_000 },
    });

    const running = worker.run(scheduleJob('running'));
    const queued = worker.run(scheduleJob('queued'));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    const stopping = worker.stop();

    await expect(running).resolves.toMatchObject({ success: false });
    await expect(queued).resolves.toMatchObject({ success: false });
    await stopping;
    expect(operationSettled).toBe(true);
  });
});
