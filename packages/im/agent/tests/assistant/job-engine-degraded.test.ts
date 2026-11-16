/** #1250 b33: degraded runs are recorded with their cause and honour `notifyOnFailure`. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TimerScheduler } from '../../src/assistant/timer-scheduler.js';
import { createNotificationRouter } from '../../src/assistant/notification-router.js';
import { ScheduleJobStore } from '../../src/assistant/job-store.js';
import type { TaskExecutor } from '../../src/task-executor.js';

const notify = { channel: 'im', target: { channel: 'im', scene: {
  platform: 'fixture', endpointKey: 'bot', sceneId: 'owner', kind: 'private',
} } } as const;

describe('TimerScheduler degraded runs (#1250 b33)', () => {
  let dataDir: string;
  beforeEach(async () => { dataDir = await mkdtemp(join(tmpdir(), 'zhin-schedule-degraded-')); vi.useFakeTimers(); });
  afterEach(async () => { vi.useRealTimers(); await rm(dataDir, { recursive: true, force: true }); });

  async function run(result: Record<string, unknown>, notifyOnFailure: boolean | undefined) {
    const execute = vi.fn(async () => ({ success: true, output: 'out', responseText: 'out', durationMs: 1, ...result }));
    const sendIm = vi.fn(async () => {});
    const store = new ScheduleJobStore({ dataDir });
    const engine = new TimerScheduler({ store,
      due: { run: (job, opts) => ({ execute } as unknown as TaskExecutor).execute(job, { signal: opts.signal, attempt: opts.attempt }) },
      router: createNotificationRouter({ resolveAdapter: () => undefined, sendIm }),
      ...(notifyOnFailure === undefined ? {} : { notifyOnFailure }) });
    try {
      await engine.addJob({ id: 'weather', label: '天气早报', enabled: true, schedule: { kind: 'every', everyMs: 60_000 },
        action: { kind: 'agent', prompt: 'weather' }, notify });
      await engine.runJobNow('weather');
      return { execute, sendIm, state: (await store.getJob('weather'))?.state };
    } finally { engine.unload(); await engine.stop(); }
  }

  it('records a degraded run as degraded with its cause, and runs it once (no retry)', async () => {
    const { execute, state, sendIm } = await run({ status: 'degraded', error: '工具 `w` 被拒绝，没有运行；排查：zhin trace t1',
      degraded: { cause: 'tool_denied', tools: ['w'], fallback: false }, delivery: { status: 'delivered', channel: 'im' } }, false);
    expect(execute).toHaveBeenCalledOnce();
    expect(state).toMatchObject({ lastStatus: 'degraded', lastError: '工具 `w` 被拒绝，没有运行；排查：zhin trace t1' });
    expect(sendIm).not.toHaveBeenCalled();
  });

  it('notifies a degraded run when notifyOnFailure is on', async () => {
    const { sendIm } = await run({ status: 'degraded', error: '工具被拒绝；排查：zhin trace t2',
      degraded: { cause: 'tool_denied', fallback: false }, delivery: { status: 'delivered', channel: 'im' } }, true);
    expect(sendIm).toHaveBeenCalledWith(notify, expect.stringContaining('[任务未完成] 天气早报: 工具被拒绝；排查：zhin trace t2'),
      undefined, { locale: 'zh-CN' });
  });

  it('does not announce twice when the delivered reply already is the fallback explanation', async () => {
    const { sendIm, state } = await run({ status: 'degraded', error: '没有可用的工具',
      degraded: { cause: 'no_tools', fallback: true }, delivery: { status: 'delivered', channel: 'im' } }, true);
    expect(state?.lastStatus).toBe('degraded');
    expect(sendIm).not.toHaveBeenCalled();
  });

  it('notifies a degraded fallback run whose explanation could not be delivered', async () => {
    const { sendIm } = await run({ status: 'degraded', error: '没有可用的工具',
      degraded: { cause: 'no_tools', fallback: true }, delivery: { status: 'failed', channel: 'im' } }, true);
    expect(sendIm).toHaveBeenCalledOnce();
  });

  it('keeps a plain success as ok without an error', async () => {
    const { state } = await run({ status: 'succeeded' }, true);
    expect(state?.lastStatus).toBe('ok');
    expect(state?.lastError).toBeUndefined();
  });
});
