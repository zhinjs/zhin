import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateJobsFile, migrateStoredJob } from '../src/store/migrate.js';

const TMP = join(process.cwd(), 'tests', '.tmp', `migrate-${Date.now()}`);

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true }).catch(() => undefined);
});

describe('store migrate', () => {
  it('migrates v1 scatter job to schema v2', async () => {
    const migrated = migrateStoredJob({
      id: 'j1',
      resolved: {
        kind: 'scatter',
        window: { start: '09:00', end: '22:00' },
        windowStartSec: 32400,
        windowEndSec: 79200,
        count: 3,
        on: 'workday',
        timezone: 'Asia/Shanghai',
      } as never,
      handlerKey: 'bubble',
      payload: { scatter: { dateKey: '2024-09-23', firedCount: 1 } },
      nextRunAt: '2024-09-23T04:00:00.000Z',
      cancelled: false,
      updatedAt: '2024-09-23T00:00:00.000Z',
    });

    expect(migrated.schemaVersion).toBe(2);
    if (migrated.resolved.kind === 'scatter') {
      expect(migrated.resolved.minGapMinutes).toBe(0);
      expect(migrated.resolved.misfire).toBe('fire');
    }
  });

  it('migrateJobsFile upgrades file on disk', async () => {
    await mkdir(TMP, { recursive: true });
    const path = join(TMP, 'jobs.json');
    await writeFile(
      path,
      JSON.stringify({
        jobs: [
          {
            id: 'j1',
            resolved: { kind: 'solar', cron: '0 0 9 * * *', timezone: 'Asia/Shanghai' },
            handlerKey: 'daily',
            nextRunAt: null,
            cancelled: false,
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      }),
    );

    const count = await migrateJobsFile(path);
    expect(count).toBe(1);
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('"schemaVersion": 2');
  });

  it('migrateJobsFile returns 0 for missing file', async () => {
    expect(await migrateJobsFile(join(TMP, 'missing.json'))).toBe(0);
  });

  it('migrateJobsFile rethrows non-ENOENT read errors', async () => {
    await mkdir(TMP, { recursive: true });
    const path = join(TMP, 'not-a-file');
    await mkdir(path, { recursive: true });
    await expect(migrateJobsFile(path)).rejects.toBeDefined();
  });
});
