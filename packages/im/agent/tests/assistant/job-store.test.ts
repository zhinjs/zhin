import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CRON_JOBS_FILENAME } from '../../src/cron-engine.js';
import { AssistantJobStore } from '../../src/assistant/job-store.js';
import { ASSISTANT_JOBS_FILENAME } from '../../src/assistant/types.js';

describe('AssistantJobStore', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'zhin-assistant-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('从 cron-jobs.json 迁移到 assistant-jobs.json', async () => {
    const legacy = [
      {
        id: 'cron_test1',
        cronExpression: '0 9 * * *',
        prompt: '早报',
        label: '早报',
        enabled: true,
        notify: { channel: 'im', platform: 'icqq', botId: '1', sceneId: '2', scope: 'private' },
        createdAt: 1000,
      },
    ];
    await writeFile(
      join(dataDir, CRON_JOBS_FILENAME),
      JSON.stringify(legacy, null, 2),
      'utf-8',
    );

    const store = new AssistantJobStore({ dataDir, legacyDualWrite: true });
    const result = await store.migrateLegacyIfNeeded();

    expect(result.migrated).toBe(1);
    expect(result.fromCron).toBe(1);

    const jobs = await store.listCronCompatible();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.prompt).toBe('早报');
    expect(jobs[0]?.cronExpression).toBe('0 9 * * *');
    expect(jobs[0]?.notify?.platform).toBe('icqq');

    const raw = await readFile(join(dataDir, ASSISTANT_JOBS_FILENAME), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.jobs).toHaveLength(1);
    expect(parsed.jobs[0].schedule.kind).toBe('cron');
  });

  it('upsert 后双写 cron-jobs.json', async () => {
    const store = new AssistantJobStore({ dataDir, legacyDualWrite: true });
    await store.upsertJob({
      id: 'cron_dual',
      enabled: true,
      schedule: { kind: 'cron', expr: '*/5 * * * *' },
      action: { kind: 'agent', prompt: 'tick' },
      notify: { channel: 'silent' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      state: {},
      source: 'manual',
    });

    const legacyRaw = await readFile(join(dataDir, CRON_JOBS_FILENAME), 'utf-8');
    const legacy = JSON.parse(legacyRaw);
    expect(legacy).toHaveLength(1);
    expect(legacy[0].prompt).toBe('tick');
  });

  it('已有 assistant-jobs 时不重复迁移', async () => {
    await writeFile(
      join(dataDir, CRON_JOBS_FILENAME),
      JSON.stringify([{ id: 'x', cronExpression: '* * * * *', prompt: 'a', enabled: true, notify: { channel: 'silent' }, createdAt: 1 }]),
      'utf-8',
    );
    await writeFile(
      join(dataDir, ASSISTANT_JOBS_FILENAME),
      JSON.stringify({ version: 1, jobs: [{ id: 'existing', enabled: true, schedule: { kind: 'cron', expr: '0 0 * * *' }, action: { kind: 'agent', prompt: 'b' }, notify: { channel: 'silent' }, createdAt: 1, updatedAt: 1, state: {} }] }),
      'utf-8',
    );

    const store = new AssistantJobStore({ dataDir });
    const result = await store.migrateLegacyIfNeeded();
    expect(result.migrated).toBe(0);
    const jobs = await store.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe('existing');
  });

  it('缺少 notify 的 cron-jobs 读取失败', async () => {
    const { readCronJobsFile } = await import('../../src/cron-engine.js');
    await writeFile(
      join(dataDir, CRON_JOBS_FILENAME),
      JSON.stringify([{
        id: 'bad',
        cronExpression: '0 9 * * *',
        prompt: 'x',
        enabled: true,
        context: { platform: 'icqq', botId: '1' },
        createdAt: 1,
      }]),
      'utf-8',
    );
    await expect(readCronJobsFile(dataDir)).rejects.toThrow(/notify/);
  });
});
