import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ScheduleJobStore } from '../../src/assistant/job-store.js';
import { SCHEDULE_JOBS_FILENAME } from '../../src/assistant/types.js';

describe('ScheduleJobStore', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'zhin-schedule-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('upsert 与 listJobs', async () => {
    const store = new ScheduleJobStore({ dataDir });
    await store.upsertJob({
      id: 'sched_test1',
      enabled: true,
      schedule: { kind: 'solar', cron: '0 0 9 * * *' },
      action: { kind: 'agent', prompt: '早报' },
      notify: { channel: 'silent' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      state: {},
      source: 'manual',
    });

    const jobs = await store.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.action.kind).toBe('agent');
    expect(jobs[0]?.schedule.kind).toBe('solar');

    const raw = await readFile(join(dataDir, SCHEDULE_JOBS_FILENAME), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.jobs).toHaveLength(1);
  });

  it('读盘时 channel:im 无 target 可合并 defaultNotify', async () => {
    const defaultNotify = {
      channel: 'im' as const,
      target: {
        channel: 'im' as const,
        scene: {
          platform: 'icqq',
          endpointId: '8596238',
          sceneId: '1659488338',
          kind: 'private' as const,
        },
      },
    };
    await writeFile(
      join(dataDir, SCHEDULE_JOBS_FILENAME),
      JSON.stringify({
        version: 1,
        jobs: [{
          id: 'legacy-im',
          enabled: true,
          schedule: { kind: 'solar', cron: '0 8 * * *' },
          action: { kind: 'agent', prompt: '早报' },
          notify: { channel: 'im' },
          createdAt: 1,
          updatedAt: 1,
          state: {},
        }],
      }),
      'utf-8',
    );
    const store = new ScheduleJobStore({ dataDir, defaultNotify });
    const jobs = await store.listJobs();
    expect(jobs[0]?.notify).toEqual(defaultNotify);
  });

  it('缺少 notify 时回退为 silent', async () => {
    await writeFile(
      join(dataDir, SCHEDULE_JOBS_FILENAME),
      JSON.stringify({
        version: 1,
        jobs: [{
          id: 'bad',
          enabled: true,
          schedule: { kind: 'solar', cron: '0 0 9 * * *' },
          action: { kind: 'agent', prompt: 'x' },
          createdAt: 1,
          updatedAt: 1,
          state: {},
        }],
      }),
      'utf-8',
    );
    const store = new ScheduleJobStore({ dataDir });
    const jobs = await store.listJobs();
    expect(jobs[0]?.notify).toEqual({ channel: 'silent' });
  });

  it('channel:im 无 target 且无 defaultNotify 时读取失败', async () => {
    await writeFile(
      join(dataDir, SCHEDULE_JOBS_FILENAME),
      JSON.stringify({
        version: 1,
        jobs: [{
          id: 'bad-im',
          enabled: true,
          schedule: { kind: 'solar', cron: '0 0 9 * * *' },
          action: { kind: 'agent', prompt: 'x' },
          notify: { channel: 'im' },
          createdAt: 1,
          updatedAt: 1,
          state: {},
        }],
      }),
      'utf-8',
    );
    const store = new ScheduleJobStore({ dataDir });
    await expect(store.listJobs()).rejects.toThrow(/target/);
  });

  it('removeJob 删除记录', async () => {
    const store = new ScheduleJobStore({ dataDir });
    await store.upsertJob({
      id: 'to-remove',
      enabled: true,
      schedule: { kind: 'every', everyMs: 60_000 },
      action: { kind: 'heartbeat', prompt: 'ping' },
      notify: { channel: 'log' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      state: {},
    });
    expect(await store.removeJob('to-remove')).toBe(true);
    expect(await store.listJobs()).toHaveLength(0);
  });
});
