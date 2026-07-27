/**
 * 第二轮审计修复的回归测试
 * - zoned-clock：DST 秋季回拨日（25h 的一天）nextLocalDayStart 不再原地踏步
 * - JobHeap：同 id 重复 push 去重，不残留旧条目
 * - LocalJsonJobStore：并发 flush 串行化，数据不丢
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ZonedClock } from '../src/utils/zoned-clock.js';
import { JobHeap, type InternalJob } from '../src/job.js';
import { createLocalJsonStore } from '../src/store/local-json-store.js';
import type { StoredJob } from '../src/store/types.js';

describe('audit fixes: ZonedClock.nextLocalDayStart (DST fall-back)', () => {
  it('美国东部 2024-11-03（25h 的一天）应推进到 11-04 零点', () => {
    const clock = new ZonedClock('America/New_York');
    const nov3Noon = clock.toUtc(2024, 11, 3, 12, 0, 0);
    const next = clock.nextLocalDayStart(nov3Noon);
    const parts = clock.partsAt(next);
    expect({ year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute }).toEqual({
      year: 2024,
      month: 11,
      day: 4,
      hour: 0,
      minute: 0,
    });
    // 必须严格晚于当日墙钟零点（不能在 25h 的一天内原地踏步）
    const sameDayMidnight = clock.toUtc(2024, 11, 3, 0, 0, 0);
    expect(next.getTime()).toBeGreaterThan(sameDayMidnight.getTime() + 86_400_000);
  });

  it('普通日期行为不变', () => {
    const clock = new ZonedClock('Asia/Shanghai');
    const noon = clock.toUtc(2025, 6, 15, 12, 0, 0);
    const next = clock.nextLocalDayStart(noon);
    const parts = clock.partsAt(next);
    expect({ year: parts.year, month: parts.month, day: parts.day, hour: parts.hour }).toEqual({
      year: 2025,
      month: 6,
      day: 16,
      hour: 0,
    });
  });
});

describe('audit fixes: JobHeap 同 id 去重', () => {
  const makeJob = (id: string, nextRunAt: Date): InternalJob => ({
    id,
    resolved: { kind: 'cron', cron: '0 0 9 * * *' } as any,
    nextRunAt,
    cancelled: false,
    ephemeral: true,
    paused: false,
    runCount: 0,
  });

  it('同 id 重复 push 只保留最新条目', () => {
    const heap = new JobHeap();
    heap.push(makeJob('job-1', new Date('2025-01-01T00:00:00Z')));
    heap.push(makeJob('job-2', new Date('2025-01-02T00:00:00Z')));
    heap.push(makeJob('job-1', new Date('2025-01-03T00:00:00Z')));
    expect(heap.size).toBe(2);
    // job-1 的最新条目应在堆中（1月3日），旧条目（1月1日）已移除
    const ids: string[] = [];
    let top: InternalJob | undefined;
    while ((top = heap.pop())) ids.push(top.id);
    expect(ids.sort()).toEqual(['job-1', 'job-2']);
  });

  it('remove 后同 id 可正常重新 push', () => {
    const heap = new JobHeap();
    heap.push(makeJob('job-1', new Date('2025-01-01T00:00:00Z')));
    heap.remove('job-1');
    heap.push(makeJob('job-1', new Date('2025-01-02T00:00:00Z')));
    expect(heap.size).toBe(1);
    expect(heap.peek()!.id).toBe('job-1');
  });
});

describe('audit fixes: LocalJsonJobStore 并发 flush', () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it('并发 upsert 后所有任务都能持久化', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'zhin-schedule-'));
    const jobsPath = join(tempDir, 'jobs.json');
    const store = createLocalJsonStore({ path: jobsPath });

    const makeStoredJob = (id: string): StoredJob => ({
      id,
      handlerKey: 'report',
      resolved: { kind: 'workday', cron: '0 0 9 * * *', timezone: 'Asia/Shanghai' } as any,
      nextRunAt: '2025-01-02T01:00:00.000Z',
      cancelled: false,
      updatedAt: new Date().toISOString(),
    });

    // 并发触发多路 flush（修复前会同时写同一 tmp 文件再 rename，存在竞态）
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => store.upsert(makeStoredJob(`job-${i}`))),
    );

    const reloaded = createLocalJsonStore({ path: jobsPath });
    const jobs = await reloaded.load();
    expect(jobs).toHaveLength(20);
    expect(new Set(jobs.map((j) => j.id)).size).toBe(20);
  });
});
