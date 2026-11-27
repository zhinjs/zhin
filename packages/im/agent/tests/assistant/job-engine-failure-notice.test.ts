/** #1250 b111: a failure notice that cannot be delivered is logged and marked on the run. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getLogger } from '@zhin.js/logger';
import {
  TimerScheduler, describeNotifyTarget, failureNoticeOutcome,
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

  async function run(sendIm: (...args: unknown[]) => Promise<unknown>, outcome: Record<string, unknown> = { success: false, output: '', error: '工具执行失败', durationMs: 1 }) {
    const warn = vi.spyOn(getLogger('timer-scheduler'), 'warn');
    const info = vi.spyOn(getLogger('timer-scheduler'), 'info');
    const execute = vi.fn(async () => outcome);
    const store = new ScheduleJobStore({ dataDir });
    const engine = new TimerScheduler({ store,
      due: { run: (job, opts) => ({ execute } as unknown as TaskExecutor).execute(job, { signal: opts.signal, attempt: opts.attempt }) },
      router: createNotificationRouter({ resolveAdapter: () => undefined, sendIm: sendIm as never }),
      notifyOnFailure: true, queue: { maxRetries: 0 } });
    try {
      await engine.addJob({ id: 'weather', label: '天气早报', enabled: true, schedule: { kind: 'every', everyMs: 3_600_000 },
        action: { kind: 'agent', prompt: 'weather' }, notify });
      await engine.runJobNow('weather');
      const logged = warn.mock.calls.map(call => String(call[0])).filter(line => line.includes('schedule_failure_notice_'));
      const infos = info.mock.calls.map(call => String(call[0])).filter(line => line.includes('schedule_failure_notice_'));
      return { state: (await store.getJob('weather'))?.state, logged, infos };
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

  it('does not mark a notice a middleware suppressed on purpose, and only logs it at info', async () => {
    const { state, logged, infos } = await run(async () => ({ status: 'suppressed' }));
    expect(state?.lastError).toBe('工具执行失败');
    expect(logged).toHaveLength(0);
    expect(infos.some(line => line.includes('schedule_failure_notice_suppressed'))).toBe(true);
  });

  it('marks a notice whose delivery is unknown as unconfirmed, not as undelivered', async () => {
    const { state, logged } = await run(async () => ({ status: 'failed',
      failure: { code: 'timeout', message: 'no response', deliveryUnknown: true } }));
    expect(state?.lastError).toBe('工具执行失败；失败通知送达未确认（timeout: no response）');
    expect(state?.lastError).not.toContain('未送达');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('schedule_failure_notice_unconfirmed');
  });

  it('marks a degraded run without an error with the note alone, not "unknown error"', async () => {
    const { state } = await run(async () => ({ status: 'rejected', failure: { code: 'forbidden', message: 'blocked' } }),
      { success: true, status: 'degraded', degraded: { reason: 'tool_failed' }, output: 'partial', durationMs: 1 });
    expect(state?.lastError).toBe('失败通知未送达（forbidden: blocked）');
    expect(state?.lastError).not.toContain('unknown error');
  });

  it('describes targets and reasons without secrets', () => {
    expect(describeNotifyTarget({ channel: 'silent' })).toBe('silent');
    expect(failureNoticeOutcome({ result: { delivered: true, channel: 'im' } })).toBeUndefined();
    expect(failureNoticeOutcome({ result: { delivered: false, channel: 'im' } })).toEqual({ kind: 'undelivered', reason: 'not delivered (im)' });
    expect(failureNoticeOutcome({ result: { delivered: false, channel: 'im', receipt: { status: 'suppressed' } } })).toEqual({ kind: 'suppressed', reason: 'status suppressed' });
    expect(failureNoticeOutcome({ error: 'x'.repeat(300) })?.reason).toHaveLength(201);
    // Redacted before it is cut: a secret across the 200-character boundary is not half kept.
    const cut = failureNoticeOutcome({ error: `${'x'.repeat(190)} token=abcdefghijklmnopqrstuvwxyz0123456789` })!.reason;
    expect(cut).not.toMatch(/abcdef|pqrstu/u);
  });
});
