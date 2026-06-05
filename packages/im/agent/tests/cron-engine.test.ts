import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Cron } from '@zhin.js/core';
import {
  PersistentCronEngine,
  readCronJobsFile,
} from '../src/cron-engine.js';

describe('PersistentCronEngine (Advanced cron_add)', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'zhin-cron-'));
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('addJob 持久化并在调度触发时调用 runner', async () => {
    const runner = vi.fn(async () => {});
    const engine = new PersistentCronEngine({
      dataDir,
      addCron: (cron: Cron) => {
        cron.run();
        return () => cron.dispose();
      },
      runner,
    });

    await engine.addJob({
      id: 'acceptance-echo',
      cronExpression: '*/1 * * * * *',
      prompt: 'echo acceptance',
      enabled: true,
      notify: { channel: 'silent' },
    });

    const jobs = await readCronJobsFile(dataDir);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.prompt).toBe('echo acceptance');

    await vi.advanceTimersByTimeAsync(2_500);
    expect(runner).toHaveBeenCalledWith('echo acceptance', 'acceptance-echo', { channel: 'silent' });
  });
});
