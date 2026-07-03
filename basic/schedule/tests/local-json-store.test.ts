import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalJsonStore } from '../src/store/local-json-store.js';
import type { StoredJob } from '../src/store/types.js';

const TEST_TMP_ROOT = join(process.cwd(), 'tests', '.tmp');

describe('LocalJsonJobStore', () => {
  let tempDir: string;
  let jobsPath: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function createStore() {
    tempDir = join(TEST_TMP_ROOT, `store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    jobsPath = join(tempDir, 'jobs.json');
    return createLocalJsonStore({ path: jobsPath });
  }

  const sampleJob = (): StoredJob => ({
    id: 'job-1',
    handlerKey: 'report',
    resolved: { kind: 'workday', cron: '0 0 9 * * *', timezone: 'Asia/Shanghai' },
    nextRunAt: '2025-01-02T01:00:00.000Z',
    cancelled: false,
    updatedAt: new Date().toISOString(),
  });

  it('upserts and loads jobs from disk', async () => {
    const store = await createStore();
    await store.upsert(sampleJob());

    const reloaded = createLocalJsonStore({ path: jobsPath });
    const jobs = await reloaded.load();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe('job-1');
  });

  it('lists due jobs', async () => {
    const store = await createStore();
    await store.upsert(sampleJob());
    await store.upsert({
      ...sampleJob(),
      id: 'job-2',
      nextRunAt: '2099-01-01T00:00:00.000Z',
    });

    const due = await store.listDue(new Date('2025-06-01T00:00:00.000Z'));
    expect(due.map((j) => j.id)).toEqual(['job-1']);
  });

  it('writes atomically via temp file', async () => {
    const store = await createStore();
    await store.upsert(sampleJob());
    const raw = await readFile(jobsPath, 'utf8');
    expect(raw).toContain('"jobs"');
    expect(raw).toContain('job-1');
  });

  it('removes jobs', async () => {
    const store = await createStore();
    await store.upsert(sampleJob());
    await store.remove('job-1');
    const jobs = await store.load();
    expect(jobs).toHaveLength(0);
  });

  it('throws when jobs file contains invalid json', async () => {
    const store = await createStore();
    await writeFile(jobsPath, '{ broken');
    await expect(store.load()).rejects.toThrow();
  });

  it('listDue skips cancelled jobs and null nextRunAt', async () => {
    const store = await createStore();
    await store.upsert({ ...sampleJob(), id: 'cancelled', cancelled: true });
    await store.upsert({ ...sampleJob(), id: 'null-next', nextRunAt: null });

    const due = await store.listDue(new Date('2099-01-01T00:00:00.000Z'));
    expect(due).toHaveLength(0);
  });

  it('listDue sorts by nextRunAt ascending', async () => {
    const store = await createStore();
    await store.upsert({
      ...sampleJob(),
      id: 'later',
      nextRunAt: '2025-06-02T01:00:00.000Z',
    });
    await store.upsert({
      ...sampleJob(),
      id: 'earlier',
      nextRunAt: '2025-06-01T01:00:00.000Z',
    });

    const due = await store.listDue(new Date('2025-12-01T00:00:00.000Z'));
    expect(due.map((j) => j.id)).toEqual(['earlier', 'later']);
  });

  it('upserts replace existing job with same id', async () => {
    const store = await createStore();
    await store.upsert(sampleJob());
    await store.upsert({ ...sampleJob(), handlerKey: 'updated' });
    const jobs = await store.load();
    expect(jobs[0].handlerKey).toBe('updated');
  });

  it('loads empty list when jobs key is missing', async () => {
    tempDir = join(TEST_TMP_ROOT, `missing-key-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    jobsPath = join(tempDir, 'jobs.json');
    await writeFile(jobsPath, '{}');
    const store = createLocalJsonStore({ path: jobsPath });
    expect(await store.load()).toEqual([]);
  });

  it('uses default jobs path when options are omitted', async () => {
    const store = createLocalJsonStore();
    const jobs = await store.load();
    expect(Array.isArray(jobs)).toBe(true);
  });

  it('loads empty list when default file is missing', async () => {
    tempDir = join(TEST_TMP_ROOT, `default-store-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const store = createLocalJsonStore({ path: join(tempDir, 'missing-jobs.json') });
    const jobs = await store.load();
    expect(jobs).toEqual([]);
  });
});
