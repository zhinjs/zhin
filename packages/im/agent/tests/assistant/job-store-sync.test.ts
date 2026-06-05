import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AssistantJobStore } from '../../src/assistant/job-store.js';

describe('AssistantJobStore scheduler sync', () => {
  it('syncSchedulerJobsFromLegacy 合并未入库的 scheduler 任务', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-sched-sync-'));
    try {
      await writeFile(
        join(dir, 'scheduler-jobs.json'),
        JSON.stringify({
          version: 1,
          jobs: [
            {
              id: 'sched-1',
              name: 'every job',
              enabled: true,
              schedule: { kind: 'every', everyMs: 60000 },
              payload: { kind: 'system_event', message: 'tick', deliver: false },
              state: {},
              createdAtMs: 1,
              updatedAtMs: 1,
            },
          ],
        }),
        'utf-8',
      );
      const store = new AssistantJobStore({ dataDir: dir, legacyDualWrite: false });
      const added = await store.syncSchedulerJobsFromLegacy();
      expect(added).toBe(1);
      const jobs = await store.listJobs();
      expect(jobs.some((j) => j.id === 'assistant-sched-1')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
