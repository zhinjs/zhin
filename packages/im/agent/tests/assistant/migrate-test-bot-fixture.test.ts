import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { copyFile, mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CRON_JOBS_FILENAME } from '../../src/cron-engine.js';
import { AssistantJobStore } from '../../src/assistant/job-store.js';

const FIXTURE = join(process.cwd(), 'examples/test-bot/data/cron-jobs.json');

async function fixtureExists(): Promise<boolean> {
  try {
    await access(FIXTURE);
    return true;
  } catch {
    return false;
  }
}

describe('migrate test-bot cron-jobs fixture', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'zhin-assistant-fixture-'));
    if (await fixtureExists()) {
      await copyFile(FIXTURE, join(dataDir, CRON_JOBS_FILENAME));
    }
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('迁移 test-bot 全部 cron 任务且保留 notify 路由', async () => {
    if (!(await fixtureExists())) return;
    const fixtureRaw = await readFile(FIXTURE, 'utf-8');
    const fixture = JSON.parse(fixtureRaw) as unknown[];
    expect(fixture.length).toBeGreaterThan(0);

    const store = new AssistantJobStore({ dataDir, legacyDualWrite: false });
    const result = await store.migrateLegacyIfNeeded();

    expect(result.migrated).toBe(fixture.length);
    expect(result.fromCron).toBe(fixture.length);

    const jobs = await store.listCronCompatible();
    expect(jobs).toHaveLength(fixture.length);

    const withIm = jobs.filter(
      (j) => j.notify?.channel === 'im' && j.notify.target.scene.platform === 'icqq',
    );
    expect(withIm.length).toBeGreaterThan(0);
  });
});
