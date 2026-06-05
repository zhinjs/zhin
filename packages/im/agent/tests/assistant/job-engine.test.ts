import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Cron } from '@zhin.js/core';
import { AssistantJobEngine } from '../../src/assistant/job-engine.js';
import { AssistantJobStore } from '../../src/assistant/job-store.js';
import { JobWorker } from '../../src/assistant/job-worker.js';
import type { TaskExecutor } from '../../src/task-executor.js';

describe('AssistantJobEngine', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'zhin-assistant-engine-'));
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('addJob 持久化并在调度触发时调用 worker', async () => {
    const executeTask = vi.fn(async () => ({
      success: true,
      responseText: 'ok',
      durationMs: 10,
    }));
    const executor = { executeTask } as unknown as TaskExecutor;
    const store = new AssistantJobStore({ dataDir, legacyDualWrite: false });
    const worker = new JobWorker({ executor });

    const engine = new AssistantJobEngine({
      store,
      worker,
      addCron: (cron: Cron) => {
        cron.run();
        return () => cron.dispose();
      },
    });

    await engine.addJob({
      id: 'assistant-echo',
      cronExpression: '*/1 * * * * *',
      prompt: 'echo assistant',
      enabled: true,
      notify: { channel: 'silent' },
    });

    const jobs = await engine.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.prompt).toBe('echo assistant');

    await vi.advanceTimersByTimeAsync(2_500);
    expect(executeTask).toHaveBeenCalled();

    const stored = await store.getJob('assistant-echo');
    expect(stored?.state.lastStatus).toBe('ok');
  });
});
