/** #1250 b111: a failure notice that cannot be delivered is logged and marked on the run. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getLogger } from '@zhin.js/logger';
import {
  TimerScheduler, describeNotifyTarget, undeliveredNoticeReason,
} from '../../src/assistant/timer-scheduler.js';
import { createNotificationRouter } from '../../src/assistant/notification-router.js';
import { ScheduleJobStore } from '../../src/assistant/job-store.js';
import type { TaskExecutor } from '../../src/task-executor.js';

const notify = { channel: 'im', target: { channel: 'im', scene: {
  platform: 'fixture', endpointKey: 'bot', sceneId: 'owner-12345', kind: 'private',
} } } as const;

describe('TimerScheduler undelivered failure notice (#1250 b111)', () => {
  let dataDir: string;
  beforeEach(async () => { dataDir = await mkdtemp(join(tmpdir(), 'zhin-schedule-notice-')); });
  afterEach(async () => { vi.restoreAllMocks(); await rm(dataDir, { recursive: true, force: true }); });

  async function run(sendIm: (...args: unknown[]) => Promise<unknown>) {
    const warn = vi.spyOn(getLogger('timer-scheduler'), 'warn');
    const execute = vi.fn(async () => ({ success: false, output: '', error: '工具执行失败', durationMs: 1 }));
    const store = new ScheduleJobStore({ dataDir });
    const engine = new TimerScheduler({ store,
      due: { run: (job, opts) => ({ execute } as unknown as TaskExecutor).execute(job, { signal: opts.signal, attempt: opts.attempt }) },
      router: createNotificationRouter({ resolveAdapter: () => undefined, sendIm: sendIm as never }),
      notifyOnFailure: true, queue: { maxRetries: 0 } });
    try {
      await engine.addJob({ id: 'weather', label: '天气早报', enabled: true, schedule: { kind: 'every', everyMs: 3_600_000 },
        action: { kind: 'agent', prompt: 'weather' }, notify });
      await engine.runJobNow('weather');
      const logged = warn.mock.calls.map(call => String(call[0])).filter(line => line.includes('schedule_failure_notice_undelivered'));
      return { state: (await store.getJob('weather'))?.state, logged };
    } finally { engine.unload(); await engine.stop(); }
  }

  it('logs and marks a notice whose send throws, with the reason redacted', async () => {
    const { state, logged } = await run(async () => { throw new Error('send failed: Authorization: Bearer abcdefghijklmnop1234'); });
    expect(state?.lastStatus).toBe('error');
    expect(state?.lastError).toContain('工具执行失败；失败通知未送达（send failed');
    expect(state?.lastError).not.toContain('abcdefghijklmnop1234');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('weather');
    expect(logged[0]).toContain('im:fixture/bot/private:ow***');
    expect(logged[0]).not.toContain('owner-12345');
    expect(logged[0]).not.toContain('abcdefghijklmnop1234');
  });

  it('logs and marks a notice the router reports as not delivered', async () => {
    const { state, logged } = await run(async () => ({ status: 'rejected', failure: { code: 'forbidden', message: 'bot was blocked' } }));
    expect(state?.lastError).toBe('工具执行失败；失败通知未送达（forbidden: bot was blocked）');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('forbidden: bot was blocked');
  });

  it('leaves a delivered notice unmarked', async () => {
    const { state, logged } = await run(async () => ({ status: 'sent' }));
    expect(state?.lastError).toBe('工具执行失败');
    expect(logged).toHaveLength(0);
  });

  it('describes targets and reasons without secrets', () => {
    expect(describeNotifyTarget({ channel: 'silent' })).toBe('silent');
    expect(undeliveredNoticeReason({ result: { delivered: true, channel: 'im' } })).toBeUndefined();
    expect(undeliveredNoticeReason({ result: { delivered: false, channel: 'im' } })).toBe('not delivered (im)');
    expect(undeliveredNoticeReason({ error: 'x'.repeat(300) })).toHaveLength(201);
  });
});
