import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ScheduleJobEngine } from '../../src/assistant/job-engine.js';
import { createNotificationRouter } from '../../src/assistant/notification-router.js';
import { ScheduleJobStore } from '../../src/assistant/job-store.js';
import { JobWorker } from '../../src/assistant/job-worker.js';
import type { TaskExecutor } from '../../src/task-executor.js';
import { DEFAULT_HEARTBEAT_PROMPT } from '../../src/assistant/profile-types.js';

describe('ScheduleJobEngine', () => {
  const router = createNotificationRouter({ resolveAdapter: () => undefined });
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'zhin-schedule-engine-'));
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('addJob 持久化并在 every 调度触发时调用 worker', async () => {
    const execute = vi.fn(async () => ({
      success: true,
      responseText: 'ok',
      durationMs: 10,
    }));
    const executor = { execute } as unknown as TaskExecutor;
    const store = new ScheduleJobStore({ dataDir });
    const worker = new JobWorker({ executor });

    const engine = new ScheduleJobEngine({ store, worker, router });
    await engine.load();

    await engine.addJob({
      id: 'sched-echo',
      enabled: true,
      schedule: { kind: 'every', everyMs: 1000 },
      action: { kind: 'agent', prompt: 'echo schedule' },
      notify: { channel: 'silent' },
    });

    const jobs = await engine.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.action.prompt).toBe('echo schedule');

    await vi.advanceTimersByTimeAsync(2_500);
    expect(execute).toHaveBeenCalled();
    expect(execute.mock.calls[0]?.[0]).toMatchObject({ id: 'sched-echo' });

    const stored = await store.getJob('sched-echo');
    expect(stored?.state.lastStatus).toBe('ok');

    engine.unload();
  });

  it.each(['en', undefined] as const)('uses the persisted job locale for failure delivery (%s)', async (locale) => {
    const sendIm = vi.fn(async () => {});
    const localizedRouter = createNotificationRouter({ resolveAdapter: () => undefined, sendIm });
    const execute = vi.fn(async () => ({ success: false, responseText: '', error: 'synthetic failure', durationMs: 1 }));
    const store = new ScheduleJobStore({ dataDir });
    const worker = new JobWorker({ executor: { execute } as unknown as TaskExecutor });
    const engine = new ScheduleJobEngine({ store, worker, router: localizedRouter, notifyOnFailure: true });
    const notify = { channel: 'im', target: { channel: 'im', scene: {
      platform: 'qq', endpointKey: 'bot1', sceneId: 'group1', kind: 'group',
    } } } as const;
    try {
      await engine.addJob({ id: 'locale-job', locale, enabled: true,
        schedule: { kind: 'every', everyMs: 60_000 }, action: { kind: 'agent', prompt: 'check weather' }, notify });
      await engine.runJobNow('locale-job');
      expect(sendIm).toHaveBeenCalledWith(notify,
        expect.stringContaining(locale === 'en' ? '[Task failed]' : '[任务失败]'),
        undefined, { locale: locale ?? 'zh-CN' });
    } finally { engine.unload(); }
  });

  it('runJob passes createdBy to task executor', async () => {
    const execute = vi.fn(async () => ({
      success: true,
      responseText: 'ok',
      durationMs: 10,
    }));
    const executor = { execute } as unknown as TaskExecutor;
    const store = new ScheduleJobStore({ dataDir });
    const worker = new JobWorker({ executor });
    const engine = new ScheduleJobEngine({ store, worker, router });

    await engine.addJob({
      id: 'sched-owner',
      enabled: true,
      schedule: { kind: 'every', everyMs: 60_000 },
      action: { kind: 'agent', prompt: 'daily weather' },
      notify: { channel: 'silent' },
      createdBy: { userId: '1659488338', roles: ['master'], name: 'Owner' },
    });
    engine.registerOne((await store.getJob('sched-owner'))!);
    await engine.runJobNow('sched-owner');

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        createdBy: {
          userId: '1659488338',
          roles: ['master'],
          name: 'Owner',
        },
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    engine.unload();
  });

  it('runJob passes executionPlan and activityFeedback to task executor', async () => {
    const execute = vi.fn(async () => ({
      success: true,
      responseText: 'ok',
      durationMs: 10,
    }));
    const executor = { execute } as unknown as TaskExecutor;
    const store = new ScheduleJobStore({ dataDir });
    const worker = new JobWorker({ executor });
    const engine = new ScheduleJobEngine({ store, worker, router });

    await engine.addJob({
      id: 'sched-plan',
      enabled: true,
      schedule: { kind: 'every', everyMs: 60_000 },
      action: { kind: 'agent', prompt: 'daily weather' },
      notify: { channel: 'silent' },
      executionPlan: {
        prompt: 'refined weather',
        tools: ['web_search'],
        skills: ['weather'],
        confirmed: true,
      },
      activityFeedback: true,
    });
    await engine.runJobNow('sched-plan');

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        executionPlan: {
          prompt: 'refined weather',
          tools: ['web_search'],
          skills: ['weather'],
          confirmed: true,
        },
        activityFeedback: true,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    engine.unload();
  });

  it.each([
    ['missing', undefined, 0],
    ['only headings and empty checkboxes', '# Heartbeat\n\n<!-- add tasks -->\n- [ ]\n', 0],
    ['an actionable task', '# Heartbeat\n- check the build every morning\n', 1],
  ])('runs the default heartbeat only when HEARTBEAT.md has a task (%s)', async (_label, content, calls) => {
    const execute = vi.fn(async () => ({ success: true, responseText: 'HEARTBEAT_OK', durationMs: 1 }));
    const store = new ScheduleJobStore({ dataDir });
    const worker = new JobWorker({ executor: { execute } as unknown as TaskExecutor });
    const engine = new ScheduleJobEngine({ store, worker, router, workspaceDir: dataDir });
    if (content !== undefined) await writeFile(join(dataDir, 'HEARTBEAT.md'), content);
    await engine.addJob({
      id: 'heartbeat',
      enabled: true,
      schedule: { kind: 'every', everyMs: 60_000 },
      action: { kind: 'heartbeat', prompt: DEFAULT_HEARTBEAT_PROMPT },
      notify: { channel: 'silent' },
    });
    await engine.runJobNow('heartbeat');
    expect(execute).toHaveBeenCalledTimes(calls);
    engine.unload();
  });

  it('runs a heartbeat with a custom prompt even without HEARTBEAT.md', async () => {
    const execute = vi.fn(async () => ({ success: true, responseText: 'ok', durationMs: 1 }));
    const store = new ScheduleJobStore({ dataDir });
    const worker = new JobWorker({ executor: { execute } as unknown as TaskExecutor });
    const engine = new ScheduleJobEngine({ store, worker, router, workspaceDir: dataDir });
    await engine.addJob({
      id: 'heartbeat',
      enabled: true,
      schedule: { kind: 'every', everyMs: 60_000 },
      action: { kind: 'heartbeat', prompt: 'Check the group for unanswered questions.' },
      notify: { channel: 'silent' },
    });
    await engine.runJobNow('heartbeat');
    expect(execute).toHaveBeenCalledTimes(1);
    engine.unload();
  });
});
