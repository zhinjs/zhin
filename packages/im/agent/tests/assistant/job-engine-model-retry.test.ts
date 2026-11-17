/**
 * #1250 b40 schedule-failed-run-marked-ok / empty-reply-fallback-misleading: a run whose model request
 * failed is an error; a transient failure (network, 5xx, timeout) is retried about 5 and 10 minutes
 * later through the scheduler's clock, and the recipient is told which job did not run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TimerScheduler } from '../../src/assistant/timer-scheduler.js';
import { createNotificationRouter } from '../../src/assistant/notification-router.js';
import { ScheduleJobStore } from '../../src/assistant/job-store.js';
import { scheduleModelFailureNotice } from '../../src/assistant/schedule-model-failure.js';
import type { TaskExecutor, TaskExecutionResult } from '../../src/task-executor.js';

const notify = { channel: 'im', target: { channel: 'im', scene: {
  platform: 'fixture', endpointKey: 'bot', sceneId: 'owner', kind: 'private',
} } } as const;
const DAY = 24 * 60 * 60_000;
const MINUTE = 60_000;

function failed(turn: string, kind = 'network', replay: 'safe' | 'committed' = 'safe'): Partial<TaskExecutionResult> {
  return { success: false, status: 'failed', output: '', responseText: '',
    error: `模型调用失败（${kind}）：连接模型服务失败，请检查网络后再试；排查：zhin trace ${turn}`,
    audit: { executionId: turn } as TaskExecutionResult['audit'],
    replay: { disposition: replay, operations: [] },
    modelFailure: { kind, transient: kind !== 'auth', service: '中转站' } };
}
function succeeded(turn: string): Partial<TaskExecutionResult> {
  return { success: true, status: 'succeeded', output: '晴', responseText: '晴',
    audit: { executionId: turn } as TaskExecutionResult['audit'], delivery: { status: 'delivered', channel: 'im' } };
}

describe('TimerScheduler model failures (#1250 b40)', () => {
  let dataDir: string;
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'zhin-schedule-model-retry-'));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-11-17T01:00:00Z'));
  });
  afterEach(async () => { vi.useRealTimers(); await rm(dataDir, { recursive: true, force: true }); });

  async function scheduler(results: Array<Partial<TaskExecutionResult>>, options: Readonly<{
    notifyOnFailure?: boolean; locale?: 'zh-CN' | 'en';
  }> = {}) {
    let calls = 0;
    const execute = vi.fn(async () => ({ durationMs: 1, toolsUsed: [], tokenUsage: { input: 0, output: 0 },
      ...results[Math.min(calls++, results.length - 1)] }));
    const sendIm = vi.fn(async () => {});
    const store = new ScheduleJobStore({ dataDir });
    const engine = new TimerScheduler({ store,
      due: { run: (job, opts) => ({ execute } as unknown as TaskExecutor).execute(job, { signal: opts.signal, attempt: opts.attempt }) },
      router: createNotificationRouter({ resolveAdapter: () => undefined, sendIm }),
      ...(options.notifyOnFailure === undefined ? {} : { notifyOnFailure: options.notifyOnFailure }) });
    await engine.addJob({ id: 'weather', label: '工作日天气早报', enabled: true, schedule: { kind: 'every', everyMs: DAY },
      action: { kind: 'agent', prompt: 'weather' }, notify, ...(options.locale ? { locale: options.locale } : {}) });
    /** A due fire, as the clock would run it. */
    const fire = () => (engine as unknown as { runJob(id: string): Promise<void> }).runJob('weather');
    const state = async () => (await store.getJob('weather'))?.state;
    return { engine, execute, sendIm, fire, state, store };
  }

  it('records a transient model failure as an error and retries it 5 minutes later, without telling the recipient yet', async () => {
    const { engine, execute, sendIm, fire, state } = await scheduler([failed('turn-1'), succeeded('turn-2')]);
    try {
      await fire();
      // No immediate re-run: the provider layer already retried the same model.
      expect(execute).toHaveBeenCalledOnce();
      expect(await state()).toMatchObject({ lastStatus: 'error', retryCount: 1, nextRunAtMs: Date.now() + 5 * MINUTE });
      expect((await state())?.lastError).toContain('模型调用失败（network）');
      expect((await state())?.lastError).toContain('5 分钟后自动重试（第 1/2 次）');
      expect(engine.pendingModelRetries()).toEqual(['weather']);
      expect(sendIm).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5 * MINUTE);
      expect(execute).toHaveBeenCalledTimes(2);
      await vi.waitFor(async () => expect(await state()).toMatchObject({ lastStatus: 'ok' }));
      expect((await state())?.lastError).toBeUndefined();
      expect((await state())?.retryCount).toBeUndefined();
      expect(engine.pendingModelRetries()).toEqual([]);
      // The successful retry's reply is the executor's delivery; nothing else was sent.
      expect(sendIm).not.toHaveBeenCalled();
    } finally { engine.unload(); await engine.stop(); }
  });

  it('retries twice (about 5 and 10 minutes), then tells the recipient it will not retry, with the trace id', async () => {
    const { engine, execute, sendIm, fire, state } = await scheduler([failed('turn-1'), failed('turn-2', 'server'), failed('turn-3')]);
    try {
      await fire();
      await vi.advanceTimersByTimeAsync(5 * MINUTE);
      expect(execute).toHaveBeenCalledTimes(2);
      await vi.waitFor(async () => expect(await state()).toMatchObject({ lastStatus: 'error', retryCount: 2 }));
      expect((await state())?.lastError).toContain('10 分钟后自动重试（第 2/2 次）');
      expect(sendIm).not.toHaveBeenCalled();
      // The second retry is due 10 minutes after the first retry ran.
      const due = (await state())!.nextRunAtMs!;
      expect(due - 10 * MINUTE).toBe((await state())!.lastExecutedAt);
      await vi.advanceTimersByTimeAsync(due - Date.now() - 1);
      expect(execute).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(execute).toHaveBeenCalledTimes(3);
      await vi.waitFor(async () => expect((await state())?.lastError).toContain('turn-3'));
      expect(engine.pendingModelRetries()).toEqual([]);
      expect(await state()).toMatchObject({ lastStatus: 'error', retryCount: 2 });
      expect((await state())?.lastError).toContain('已自动重试 2 次，不再重试');
      await vi.waitFor(() => expect(sendIm).toHaveBeenCalledOnce());
      expect(sendIm).toHaveBeenCalledWith(notify,
        '『工作日天气早报』这次没生成：模型服务（中转站）暂时连不上，已自动重试 2 次，不再重试。排查：zhin trace turn-3',
        undefined, { locale: 'zh-CN' });
      // No more retries after that.
      await vi.advanceTimersByTimeAsync(60 * MINUTE);
      expect(execute).toHaveBeenCalledTimes(3);
    } finally { engine.unload(); await engine.stop(); }
  });

  it('tells a job that asks for failure notices about every failure, with when it retries', async () => {
    const { engine, sendIm, fire } = await scheduler([failed('turn-1'), succeeded('turn-2')], { notifyOnFailure: true });
    try {
      await fire();
      expect(sendIm).toHaveBeenCalledWith(notify, '『工作日天气早报』这次没生成：模型服务（中转站）暂时连不上，5 分钟后会自动重试。',
        undefined, { locale: 'zh-CN' });
      await vi.advanceTimersByTimeAsync(5 * MINUTE);
      expect(sendIm).toHaveBeenCalledOnce();
    } finally { engine.unload(); await engine.stop(); }
  });

  it('writes the notice in the job locale', async () => {
    const { engine, sendIm, fire } = await scheduler([failed('turn-1', 'server')], { notifyOnFailure: true, locale: 'en' });
    try {
      await fire();
      expect(sendIm).toHaveBeenCalledWith(notify,
        '"工作日天气早报" was not generated this time: the model service (中转站) is temporarily unavailable; it will retry automatically in 5 minutes.',
        undefined, { locale: 'en' });
    } finally { engine.unload(); await engine.stop(); }
  });

  it('does not retry a model failure another attempt cannot fix, and says so right away', async () => {
    const { engine, execute, sendIm, fire, state } = await scheduler([failed('turn-1', 'auth')]);
    try {
      await fire();
      await vi.advanceTimersByTimeAsync(30 * MINUTE);
      expect(execute).toHaveBeenCalledOnce();
      expect(await state()).toMatchObject({ lastStatus: 'error' });
      expect((await state())?.retryCount).toBeUndefined();
      expect(sendIm).toHaveBeenCalledWith(notify,
        '『工作日天气早报』这次没生成：模型服务（中转站）调用失败（auth），不会自动重试。排查：zhin trace turn-1', undefined, { locale: 'zh-CN' });
    } finally { engine.unload(); await engine.stop(); }
  });

  it('does not retry a run whose tools may already have had an effect', async () => {
    const { engine, execute, fire } = await scheduler([failed('turn-1', 'network', 'committed')]);
    try {
      await fire();
      await vi.advanceTimersByTimeAsync(30 * MINUTE);
      expect(execute).toHaveBeenCalledOnce();
      expect(engine.pendingModelRetries()).toEqual([]);
    } finally { engine.unload(); await engine.stop(); }
  });

  it('drops a pending retry when the job is paused, and does not retry a manual run', async () => {
    const { engine, execute, fire } = await scheduler([failed('turn-1'), failed('turn-2')]);
    try {
      await fire();
      expect(engine.pendingModelRetries()).toEqual(['weather']);
      await engine.pauseJob('weather');
      expect(engine.pendingModelRetries()).toEqual([]);
      await vi.advanceTimersByTimeAsync(30 * MINUTE);
      expect(execute).toHaveBeenCalledOnce();
      await engine.resumeJob('weather');
      await engine.runJobNow('weather');
      await vi.advanceTimersByTimeAsync(30 * MINUTE);
      expect(execute).toHaveBeenCalledTimes(2);
    } finally { engine.unload(); await engine.stop(); }
  });

  it('does not keep promising a retry that a pause dropped', async () => {
    const { engine, fire, state } = await scheduler([failed('turn-1'), failed('turn-2'), failed('turn-3')]);
    try {
      await fire();
      expect((await state())?.lastError).toContain('5 分钟后自动重试（第 1/2 次）');
      await engine.pauseJob('weather');
      expect((await state())?.lastError).toBe('模型调用失败（network）：连接模型服务失败，请检查网络后再试；排查：zhin trace turn-1；自动重试已取消');
      expect((await state())?.retryCount).toBeUndefined();
      await engine.resumeJob('weather');
      await fire();
      await vi.advanceTimersByTimeAsync(5 * MINUTE);
      await vi.waitFor(async () => expect((await state())?.lastError).toContain('10 分钟后自动重试（第 2/2 次）'));
      await engine.pauseJob('weather');
      expect(await state()).toMatchObject({ retryCount: 1,
        lastError: '模型调用失败（network）：连接模型服务失败，请检查网络后再试；排查：zhin trace turn-3；已自动重试 1 次，其余自动重试已取消' });
    } finally { engine.unload(); await engine.stop(); }
  });

  it('does not keep promising a retry that a restart lost', async () => {
    const { engine, fire, state, store, execute } = await scheduler([failed('turn-1')]);
    await fire();
    expect(engine.pendingModelRetries()).toEqual(['weather']);
    engine.unload();
    await engine.stop();
    const restarted = new TimerScheduler({ store, due: { run: async () => { throw new Error('not run'); } },
      router: createNotificationRouter({ resolveAdapter: () => undefined, sendIm: async () => {} }) });
    try {
      await restarted.load();
      expect(restarted.pendingModelRetries()).toEqual([]);
      const after = await state();
      expect(after?.lastError).toBe('模型调用失败（network）：连接模型服务失败，请检查网络后再试；排查：zhin trace turn-1；自动重试已取消');
      expect(after?.retryCount).toBeUndefined();
      expect(after?.lastStatus).toBe('error');
      // The next run is the regular one again, not the lost retry.
      expect(after?.nextRunAtMs).toBe(after!.lastExecutedAt! + DAY);
      await vi.advanceTimersByTimeAsync(30 * MINUTE);
      expect(execute).toHaveBeenCalledOnce();
    } finally { restarted.unload(); await restarted.stop(); }
  });

  it('drops a pending retry when the job is removed, run by hand, fired on schedule or unloaded', async () => {
    for (const cancel of ['remove', 'manual', 'fire', 'unload'] as const) {
      const { engine, execute, fire } = await scheduler([failed('turn-1'), succeeded('turn-2')]);
      try {
        await fire();
        expect(engine.pendingModelRetries()).toEqual(['weather']);
        if (cancel === 'remove') await engine.removeJob('weather');
        else if (cancel === 'manual') await engine.runJobNow('weather');
        else if (cancel === 'fire') await fire();
        else engine.unload();
        expect(engine.pendingModelRetries()).toEqual([]);
        const runs = execute.mock.calls.length;
        await vi.advanceTimersByTimeAsync(30 * MINUTE);
        expect(execute.mock.calls.length).toBe(runs);
      } finally { engine.unload(); await engine.stop(); }
    }
  });

  it('words timeouts and unnamed services, in both languages', () => {
    const failure = { kind: 'timeout', transient: true } as const;
    expect(scheduleModelFailureNotice('zh-CN', { label: '早报', failure, turnId: 't', retries: 0, retryInMs: 10 * MINUTE }))
      .toBe('『早报』这次没生成：模型服务响应超时，10 分钟后会自动重试。');
    expect(scheduleModelFailureNotice('en', { label: 'Brief', failure, turnId: 't', retries: 2 }))
      .toBe('"Brief" was not generated this time: the model service timed out; retried automatically 2 time(s), no further retries. To investigate: zhin trace t');
  });
});
