import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseScheduleHistoryRepository, FileScheduleHistoryRepository, ScheduleExecutionHistory, SCHEDULE_RUN_MODEL, SCHEDULE_ATTEMPT_MODEL,
  historyKey, scheduleHistoryCutoff, type ScheduleRunContext, type ScheduleAttemptIdentity, type ScheduleHistoryResult, type ScheduleHistoryRepository } from '@zhin.js/agent/runtime';
import { createDatabaseHost } from '../../../src/plugin-runtime/database-host-installer.js';
import { JobWorker, createTaskExecutor, createNotificationRouter } from '@zhin.js/agent';
import { createScheduleAuditRecord } from '../../../../../packages/im/agent/src/schedule-domain/audit-logger.js';

const OWNER = 100;
const NOW = Date.UTC(2026, 2, 31, 10, 15, 20, 123);
const result: ScheduleHistoryResult = { success: true, output: 'Verified result', durationMs: 20, tokenUsage: { input: 2, output: 3 },
  replay: { disposition: 'safe', operations: [] }, delivery: { status: 'unknown', channel: 'im', message: 'Unconfirmed' } };
const run = (runId: string, queuedAt = NOW, jobId = 'job'): ScheduleRunContext => ({ runId, jobId, queuedAt, source: 'manual', job: {
  id: jobId, label: 'Daily report', enabled: true, schedule: { kind: 'every', everyMs: 60_000 },
  action: { kind: 'agent', prompt: 'Summarize synthetic records.' }, notify: { channel: 'im', target: { channel: 'im', scene: {
    platform: 'icqq', endpointKey: 'account-identity', kind: 'channel', sceneId: 'room', parent: { kind: 'channel', sceneId: 'guild' },
  }, threadId: 'topic' } }, createdBy: { userId: 'owner', roles: ['master'] }, createdAt: 1, updatedAt: 1, state: {},
} });
const attempt = (context: ScheduleRunContext, number = 1): ScheduleAttemptIdentity => ({ runId: context.runId, jobId: context.jobId,
  attemptId: `${context.runId}-attempt-${number}`, number, startedAt: context.queuedAt + number });
async function complete(store: ScheduleExecutionHistory, context: ScheduleRunContext) {
  const current = attempt(context);
  await store.observe({ type: 'run_queued', run: context });
  await store.observe({ type: 'attempt_started', attempt: current });
  await store.observe({ type: 'attempt_progress', runId: context.runId, jobId: context.jobId, attemptId: current.attemptId,
    at: context.queuedAt + 2, phase: 'tool', status: 'completed', toolName: 'read_record', toolUseId: 'call-1' });
  await store.observe({ type: 'attempt_finished', attempt: current, finishedAt: context.queuedAt + 20, result });
  await store.observe({ type: 'attempt_replay', runId: context.runId, jobId: context.jobId, attemptId: current.attemptId,
    decision: 'stop', reason: 'attempt_budget_exhausted' });
  await store.observe({ type: 'run_finished', runId: context.runId, jobId: context.jobId, finishedAt: context.queuedAt + 20, result });
}

describe.each(['file', 'sqlite'] as const)('execution history (%s)', mode => {
  let directory: string;
  let database: ReturnType<typeof createDatabaseHost> | undefined;
  let repository: ScheduleHistoryRepository;
  let store: ScheduleExecutionHistory;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'zhin-execution-history-'));
    if (mode === 'sqlite') {
      database = createDatabaseHost({ dialect: 'sqlite', filename: join(directory, 'history.sqlite') });
      database.define('agent_schedule_runs', SCHEDULE_RUN_MODEL);
      database.define('agent_schedule_attempts', SCHEDULE_ATTEMPT_MODEL);
      await database.start();
      repository = new DatabaseScheduleHistoryRepository(database);
    } else repository = new FileScheduleHistoryRepository(directory);
    store = new ScheduleExecutionHistory({ repository, now: () => NOW, ownerStartedAt: OWNER });
  });
  afterEach(async () => { await database?.stop(); database = undefined; await rm(directory, { recursive: true, force: true }); });

  it('persists attempts, exact target, process and result separately from delivery and task definitions', async () => {
    await complete(store, run('one'));
    const detail = await store.read({ runId: 'one', jobId: 'job' });
    expect(detail?.status).toBe('succeeded');
    expect(detail?.result).toMatchObject({ output: 'Verified result', delivery: { status: 'unknown' } });
    expect(detail?.job.notify).toEqual(run('one').job.notify);
    expect(detail?.attempts[0]).toMatchObject({ attemptId: 'one-attempt-1', progress: [{ phase: 'tool', toolName: 'read_record' }],
      retry: { decision: 'stop', reason: 'attempt_budget_exhausted' } });
    expect(await store.read({ runId: 'one', jobId: 'another-job' })).toBeUndefined();
    const page = await store.page({ jobId: 'job', limit: 10 });
    expect(page.runs).toHaveLength(1);
    expect(page.runs[0]).not.toHaveProperty('result');
    expect(page.runs[0]).not.toHaveProperty('job');
    expect(page.runs[0]).not.toHaveProperty('ownerStartedAt');
    const read = vi.spyOn(repository, 'read').mockRejectedValueOnce(new Error('synthetic read outage'));
    await expect(store.read({ runId: 'one' })).rejects.toThrow('synthetic read outage');
    expect(read).toHaveBeenCalledOnce(); // Successful terminal data was released, not kept as a private cache.
  });

  it('uses a stable composite cursor when several runs share their timestamp', async () => {
    for (const id of ['a', 'b', 'c', 'd']) await complete(store, run(id));
    const seen: string[] = [];
    let before;
    do {
      const page = await store.page({ jobId: 'job', limit: 1, before });
      seen.push(...page.runs.map(row => row.runId)); before = page.nextCursor;
    } while (before);
    expect(new Set(seen).size).toBe(4);
    expect(seen).toEqual(['a', 'b', 'c', 'd'].sort((a, b) => historyKey(b).localeCompare(historyKey(a))));
    expect((await store.page({ jobId: 'another-job', limit: 10 })).runs).toEqual([]);
  });

  it('restores unfinished records as interrupted only across processes, without inventing a finish or replay', async () => {
    const context = run('pending');
    await store.observe({ type: 'run_queued', run: context });
    await store.observe({ type: 'attempt_started', attempt: attempt(context) });
    const sameProcess = new ScheduleExecutionHistory({ repository, ownerStartedAt: OWNER });
    expect((await store.read({ runId: 'pending' }))?.status).toBe('running');
    expect((await sameProcess.read({ runId: 'pending' }))?.status).toBe('unsettled');
    const restarted = new ScheduleExecutionHistory({ repository, ownerStartedAt: OWNER + 1 });
    const recovered = await restarted.read({ runId: 'pending' });
    expect(recovered).toMatchObject({ status: 'interrupted' });
    expect(recovered?.finishedAt).toBeUndefined();
    expect(recovered?.result).toBeUndefined();
    expect((await restarted.page({ limit: 10 })).runs[0]?.status).toBe('interrupted');
  });

  it('cleans only expired inactive history by UTC calendar month and leaves an active run and task data intact', async () => {
    const cutoff = scheduleHistoryCutoff(NOW);
    expect(new Date(cutoff).toISOString()).toBe('2026-02-28T10:15:20.123Z');
    await complete(store, run('old', cutoff - 1));
    await complete(store, run('edge', cutoff));
    await store.observe({ type: 'run_queued', run: run('active', cutoff - 100) });
    expect(await store.cleanup()).toEqual({ deleted: 1, cutoff });
    expect(await store.read({ runId: 'old' })).toBeUndefined();
    expect(await store.read({ runId: 'edge' })).toBeDefined();
    expect(await store.read({ runId: 'active' })).toBeDefined();
    expect((await store.cleanup()).deleted).toBe(0);
    const restarted = new ScheduleExecutionHistory({ repository, ownerStartedAt: OWNER + 1, now: () => NOW });
    expect((await restarted.cleanup()).deleted).toBe(1);
  });

  it('preserves a write failure as a recording gap then flushes the complete observation without a business retry', async () => {
    const fail = vi.spyOn(repository, 'save').mockRejectedValueOnce(new Error('synthetic disk failure'));
    const context = run('gap');
    await expect(store.observe({ type: 'run_queued', run: context })).rejects.toThrow('synthetic disk failure');
    expect((await store.page({ limit: 10 })).runs[0]).toMatchObject({ runId: 'gap', recordingIssue: true });
    await store.observe({ type: 'attempt_started', attempt: attempt(context) });
    expect((await store.read({ runId: 'gap' }))?.recordingIssue).toBeUndefined();
    expect(fail).toHaveBeenCalledTimes(2);
    expect((await repository.read({ runId: 'gap' }))?.attempts).toHaveLength(1);
  });

  it('releases terminal output after storage failure and exposes constant recording health instead of a false live state', async () => {
    const context = run('terminal-gap');
    const current = attempt(context);
    await store.observe({ type: 'run_queued', run: context });
    await store.observe({ type: 'attempt_started', attempt: current });
    vi.spyOn(repository, 'save').mockRejectedValue(new Error('synthetic terminal failure'));
    await expect(store.observe({ type: 'run_finished', runId: context.runId, jobId: context.jobId,
      finishedAt: NOW + 1, result: { ...result, output: 'UNPERSISTED_BODY_MUST_NOT_BE_CACHED' } })).rejects.toThrow('synthetic terminal failure');
    const detail = await store.read({ runId: context.runId });
    expect(detail).toMatchObject({ status: 'unsettled', recordingIssue: true });
    expect(detail?.result).toBeUndefined();
    expect(detail?.finishedAt).toBeUndefined();
    const page = await store.page({ limit: 10 });
    expect(page.runs[0]).toMatchObject({ status: 'unsettled', recordingIssue: true });
    expect(page.recordingHealth).toMatchObject({ activeWriteFailures: 0, incompleteCompletedRuns: 1,
      lastRun: { runId: context.runId, jobId: context.jobId } });
    expect(JSON.stringify(page)).not.toContain('UNPERSISTED_BODY_MUST_NOT_BE_CACHED');
    expect(JSON.stringify(detail)).not.toContain('UNPERSISTED_BODY_MUST_NOT_BE_CACHED');
  });

  it.each(['start', 'terminal'] as const)('keeps one business execution when actual %s persistence fails through Worker and TaskExecutor', async failure => {
    const original = repository.save.bind(repository);
    let saves = 0;
    vi.spyOn(repository, 'save').mockImplementation(async record => {
      if ((failure === 'start' && saves++ === 0) || (failure === 'terminal' && record.finishedAt !== undefined)) throw new Error('synthetic observation failure');
      await original(record);
    });
    let effects = 0;
    const executor = createTaskExecutor({ history: store, router: createNotificationRouter({ resolveAdapter: () => undefined }), domain: {
      execute: async (job, options) => {
        effects++;
        const audit = createScheduleAuditRecord({ jobId: job.id, executionId: options?.attempt?.identity.attemptId ?? 'synthetic-attempt',
          timestamp: NOW, prompt: job.action.prompt, toolsResolved: [], toolsResolvedBy: 'affinity', missingTools: [], missingSkills: [],
          success: true, outputLength: 8 });
        return { success: true, output: 'Verified', durationMs: 1, toolsUsed: [], tokenUsage: { input: 1, output: 1 }, audit };
      },
    } });
    const worker = new JobWorker({ executor, history: store, queue: { maxRetries: 2 } });
    try {
      const task = await worker.run({ ...run('business').job, notify: { channel: 'silent' } });
      await store.drain();
      expect(task.success).toBe(true);
      expect(effects).toBe(1);
      const page = await store.page({ limit: 10 });
      if (failure === 'terminal') expect(page.recordingHealth.incompleteCompletedRuns).toBe(1);
      else expect(page.recordingHealth.activeWriteFailures).toBe(0);
    } finally { await worker.stop(); await executor.dispose(); }
  });

  it('saves only the approved result projection, scrubbing secrets and inline images without clipping the final text', async () => {
    const context = run('privacy');
    const current = attempt(context);
    const response = { ...result, output: `password=synthetic-password\n${'完整结果'.repeat(20_000)}\ndata:image/png;base64,AAAA`,
      audit: { privateToolArguments: 'must-not-persist' } };
    await store.observe({ type: 'run_queued', run: context });
    await store.observe({ type: 'attempt_started', attempt: current });
    await store.observe({ type: 'attempt_finished', attempt: current, finishedAt: NOW + 1, result: response });
    await store.observe({ type: 'run_finished', runId: context.runId, jobId: context.jobId, finishedAt: NOW + 1, result: response });
    const detail = JSON.stringify(await store.read({ runId: 'privacy' }));
    expect(detail).not.toContain('synthetic-password');
    expect(detail).not.toContain('data:image');
    expect(detail).not.toContain('must-not-persist');
    expect(detail).toContain('完整结果'.repeat(20_000));
    expect(Buffer.byteLength(detail)).toBeGreaterThan(65_536);
    if (mode === 'file') {
      expect((await readdir(directory)).every(name => name.endsWith('.history'))).toBe(true);
      expect(await readFile(join(directory, `${historyKey('privacy')}.history`), 'utf8')).not.toContain('synthetic-password');
    }
  });
});

it('uses leap-year clamping and preserves UTC time at the natural-month cutoff', () => {
  expect(new Date(scheduleHistoryCutoff(Date.UTC(2024, 2, 31, 23, 59, 58))).toISOString()).toBe('2024-02-29T23:59:58.000Z');
  expect(new Date(scheduleHistoryCutoff(Date.UTC(2026, 0, 31, 12))).toISOString()).toBe('2025-12-31T12:00:00.000Z');
});
