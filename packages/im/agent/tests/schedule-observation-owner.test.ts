import { createScheduleAuditRecord } from '../src/schedule-domain/audit-logger.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileScheduleHistoryRepository } from '../src/schedule-domain/execution-history-file.js';
import { ScheduleExecutionHistory, SCHEDULE_OBSERVATION_MAX_BYTES, SCHEDULE_OBSERVATION_MAX_RUNS,
  type ScheduleHistoryRecord, type ScheduleHistoryRepository } from '../src/schedule-domain/execution-history-store.js';
import type { ScheduleAttemptIdentity, ScheduleHistoryResult, ScheduleRunContext } from '../src/schedule-domain/execution-history.js';
import { createScheduleExecutionFixture, scheduleFixtureJob } from './helpers/schedule-execution-fixture.js';

const result: ScheduleHistoryResult = { success: true, output: 'Final business output', durationMs: 1, tokenUsage: { input: 1, output: 1 } };
const run = (runId: string): ScheduleRunContext => ({ runId, jobId: 'job', queuedAt: 100, source: 'manual', job: { ...scheduleFixtureJob, id: 'job' } });
const attempt = (runId: string): ScheduleAttemptIdentity => ({ runId, jobId: 'job', attemptId: `${runId}-attempt`, number: 1, startedAt: 101 });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function repository(): ScheduleHistoryRepository & { records: Map<string, ScheduleHistoryRecord> } {
  const records = new Map<string, ScheduleHistoryRecord>();
  return { records, save: vi.fn(async record => { records.set(record.runId, record); }),
    read: vi.fn(async ({ runId }) => records.get(runId)), page: vi.fn(async () => []), prune: vi.fn(async () => 0) };
}
function settle(owner: ScheduleExecutionHistory, runId: string, output = result.output) {
  owner.observe({ type: 'run_queued', run: run(runId) });
  owner.observe({ type: 'run_finished', runId, jobId: 'job', finishedAt: 102, result: { ...result, output } });
}
const audit = (runId: string, prompt = '') => createScheduleAuditRecord({ jobId: 'job', executionId: `${runId}-attempt`, timestamp: 101,
  prompt, toolsResolved: [], toolsResolvedBy: 'affinity', skillsResolved: [], missingTools: [], missingSkills: [] });

afterEach(() => { vi.unstubAllEnvs(); });

it('repairs a real file save that persisted then threw when a new execution fact arrives', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-history-unknown-save-'));
  const repo = new FileScheduleHistoryRepository(directory);
  const physicalSave = repo.save.bind(repo);
  const save = vi.spyOn(repo, 'save').mockImplementationOnce(async record => {
    await physicalSave(record); throw new Error('synthetic post-rename durability error');
  });
  const owner = new ScheduleExecutionHistory({ repository: repo, secrets: [] });
  try {
    owner.observe({ type: 'run_queued', run: run('unknown-save') });
    await owner.drain();
    expect((await repo.read({ runId: 'unknown-save' }))?.attempts).toHaveLength(0);
    expect(owner.health().activeWriteFailures).toBe(1);
    owner.observe({ type: 'attempt_started', attempt: attempt('unknown-save') });
    await owner.drain();
    expect(save).toHaveBeenCalledTimes(2);
    expect((await repo.read({ runId: 'unknown-save' }))?.attempts).toHaveLength(1);
    expect(owner.health().activeWriteFailures).toBe(0);
  } finally { owner.close(); await rm(directory, { recursive: true, force: true }); }
});

it('does not confuse an initial lookup failure with absence', async () => {
  const repo = repository();
  vi.mocked(repo.read).mockRejectedValueOnce(new Error('synthetic lookup outage'));
  const owner = new ScheduleExecutionHistory({ repository: repo, secrets: [] });
  owner.observe({ type: 'run_queued', run: run('lookup-error') });
  await owner.drain();
  expect(repo.save).not.toHaveBeenCalled();
  owner.observe({ type: 'attempt_started', attempt: attempt('lookup-error') });
  await owner.drain();
  expect(repo.read).toHaveBeenCalledTimes(2);
  expect(repo.save).toHaveBeenCalledOnce();
  expect(repo.records.get('lookup-error')?.attempts).toHaveLength(1);
  owner.close();
});

it('rejects an existing external run on every new fact instead of claiming its identity', async () => {
  const repo = repository(); const existingOwner = new ScheduleExecutionHistory({ repository: repo, secrets: [] });
  settle(existingOwner, 'external-run'); await existingOwner.drain(); existingOwner.close();
  vi.mocked(repo.save).mockClear();
  const owner = new ScheduleExecutionHistory({ repository: repo, secrets: [] });
  owner.observe({ type: 'run_queued', run: { ...run('external-run'), queuedAt: 999 } });
  await owner.drain();
  owner.observe({ type: 'attempt_started', attempt: attempt('external-run') });
  await owner.drain();
  expect(repo.save).not.toHaveBeenCalled();
  expect(repo.records.get('external-run')?.queuedAt).toBe(100);
  expect(repo.records.get('external-run')?.result?.output).toBe(result.output);
  owner.close();
});

it('counts a recreated same-run state separately from the old in-flight body despite equal local revisions', async () => {
  const held = deferred(); const writes: number[] = [];
  const owner = new ScheduleExecutionHistory({ secrets: [], auditLogger: { write: async record => { writes.push(record.prompt.length); await held.promise; } } });
  const base = audit('recreated');
  const overhead = Buffer.byteLength(JSON.stringify({ auxiliary: [{ kind: 'audit', record: base }] }));
  const full = { ...base, prompt: 'x'.repeat(SCHEDULE_OBSERVATION_MAX_BYTES - overhead) };
  try {
    owner.audit({ attempt: attempt('recreated'), record: full });
    owner.activity({ attempt: attempt('recreated'), event: { phase: 'finish', job: scheduleFixtureJob, notify: { channel: 'silent' } } });
    expect(owner.health().incompleteCompletedRuns).toBe(1);
    owner.audit({ attempt: attempt('recreated'), record: full });
    expect(owner.health().incompleteCompletedRuns).toBe(2);
    held.resolve(); await owner.drain();
    expect(writes).toHaveLength(1);
  } finally { owner.close(); held.resolve(); }
});

it('does not let an old failed write drop a replacement state with the same run alias', async () => {
  const held = deferred(); const writes: number[] = [];
  const owner = new ScheduleExecutionHistory({ secrets: [], auditLogger: { write: async record => {
    writes.push(record.prompt.length);
    if (writes.length === 1) { await held.promise; throw new Error('synthetic old write failure'); }
  } } });
  try {
    owner.audit({ attempt: attempt('replacement'), record: audit('replacement', 'x'.repeat(8 * 1024 * 1024)) });
    owner.activity({ attempt: attempt('replacement'), event: { phase: 'finish', job: { ...scheduleFixtureJob,
      action: { kind: 'agent', prompt: 'p'.repeat(9 * 1024 * 1024) } }, notify: { channel: 'silent' } } });
    expect(owner.health().incompleteCompletedRuns).toBe(1);
    owner.audit({ attempt: attempt('replacement'), record: audit('replacement', 'new fact') });
    held.resolve(); await owner.drain();
    expect(writes).toEqual([8 * 1024 * 1024, 'new fact'.length]);
  } finally { owner.close(); held.resolve(); }
});

it('returns active query snapshots while the physical writer never settles', async () => {
  const repo = repository(); const held = deferred();
  vi.mocked(repo.save).mockImplementation(() => held.promise);
  const owner = new ScheduleExecutionHistory({ repository: repo, secrets: [] });
  owner.observe({ type: 'run_queued', run: run('read-with-hung-writer') });
  let returned = 0;
  const page = owner.page({ limit: 10 }).then(value => { returned++; return value; });
  const detail = owner.read({ runId: 'read-with-hung-writer' }).then(value => { returned++; return value; });
  try {
    // Responsive repository reads resolve in microtasks; a pending write must not become their dependency.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(returned).toBe(2);
    expect((await page).runs[0]?.runId).toBe('read-with-hung-writer');
    expect((await detail)?.status).toBe('queued');
  } finally { held.resolve(); await owner.drain(); }
});

it('keeps actual Worker/Domain/tool execution and reads independent of a hung physical history write', async () => {
  const repo = repository(); const held = deferred();
  vi.mocked(repo.save).mockImplementation(() => held.promise);
  const owner = new ScheduleExecutionHistory({ repository: repo, secrets: [] });
  const fixture = createScheduleExecutionFixture({ readOnly: true, observations: owner });
  try {
    const completed = await fixture.worker.run(scheduleFixtureJob);
    expect(completed.success).toBe(true);
    expect(fixture.turns()).toBe(1);
    const page = await owner.page({ limit: 10 });
    expect(page.runs).toHaveLength(1);
    expect(page.runs[0]!.status).toBe('succeeded');
    expect((await owner.read({ runId: page.runs[0]!.runId }))?.result?.output).toBe('Final output');
    expect(repo.save).toHaveBeenCalledOnce();
    owner.close(); // Does not await a driver that cannot be cancelled.
    expect(owner.health().incompleteCompletedRuns).toBe(1);
    expect(await owner.read({ runId: page.runs[0]!.runId })).toBeUndefined();
  } finally { held.resolve(); await fixture.dispose(); }
});

it('coalesces a run while one write is held, retaining ordered progress instead of per-event promises', async () => {
  const repo = repository(); const held = deferred();
  const save = repo.save;
  vi.mocked(repo.save).mockImplementationOnce(async record => { await held.promise; repo.records.set(record.runId, record); });
  const owner = new ScheduleExecutionHistory({ repository: repo, secrets: [] });
  owner.observe({ type: 'run_queued', run: run('coalesced') });
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
  owner.observe({ type: 'attempt_started', attempt: attempt('coalesced') });
  for (let i = 0; i < 100; i++) owner.observe({ type: 'attempt_progress', ...attempt('coalesced'), at: 102 + i, phase: 'model', status: `phase-${i}` });
  owner.observe({ type: 'run_finished', runId: 'coalesced', jobId: 'job', finishedAt: 300, result });
  expect((await owner.read({ runId: 'coalesced' }))?.attempts[0]?.progress).toHaveLength(100);
  held.resolve(); await owner.drain();
  expect(save).toHaveBeenCalledTimes(2);
  expect(repo.records.get('coalesced')?.attempts[0]?.progress.map(value => value.status)).toEqual(Array.from({ length: 100 }, (_, i) => `phase-${i}`));
  owner.close();
});

it('admits exactly 128 unpersisted terminal runs including the in-flight run, then resumes after capacity returns', async () => {
  const held = deferred(); const writes: string[] = [];
  const owner = new ScheduleExecutionHistory({ secrets: [], auditLogger: { write: async record => {
    writes.push(record.executionId); if (writes.length === 1) await held.promise;
  } } });
  owner.audit({ attempt: attempt('run-0'), record: audit('run-0') });
  owner.activity({ attempt: attempt('run-0'), event: { phase: 'finish', job: { ...scheduleFixtureJob, id: 'job' }, notify: { channel: 'silent' } } });
  for (let i = 1; i < SCHEDULE_OBSERVATION_MAX_RUNS + 1; i++) owner.audit({ attempt: attempt(`run-${i}`), record: audit(`run-${i}`) });
  expect(writes).toHaveLength(1);
  expect(owner.health()).toMatchObject({ incompleteCompletedRuns: 1, lastRun: { runId: 'run-128' } });
  held.resolve(); await owner.drain();
  expect(writes).toHaveLength(128);
  owner.audit({ attempt: attempt('recovered'), record: audit('recovered') });
  await owner.drain();
  expect(writes.at(-1)).toBe('recovered-attempt');
  expect(owner.health().incompleteCompletedRuns).toBe(1);
  owner.close();
});

it('uses UTF-8 serialized bytes at the exact 16 MiB boundary and counts an in-flight body', async () => {
  const held = deferred(); const writes: string[] = [];
  const owner = new ScheduleExecutionHistory({ secrets: [], auditLogger: { write: async record => { writes.push(record.executionId); await held.promise; } } });
  const base = audit('bytes');
  const overhead = Buffer.byteLength(JSON.stringify({ auxiliary: [{ kind: 'audit', record: base }] }));
  const promptBytes = SCHEDULE_OBSERVATION_MAX_BYTES - overhead;
  const prompt = 'é'.repeat(Math.floor(promptBytes / 2)) + (promptBytes % 2 ? 'x' : '');
  owner.audit({ attempt: attempt('bytes'), record: { ...base, prompt } });
  expect(writes).toEqual(['bytes-attempt']); // Exact boundary is admitted.
  owner.audit({ attempt: attempt('over-budget'), record: audit('over-budget') });
  expect(owner.health()).toMatchObject({ incompleteCompletedRuns: 1, lastRun: { runId: 'over-budget' } });
  owner.close(); held.resolve();
});

it('counts both retained bodies when an in-flight active snapshot gains a newer terminal snapshot', async () => {
  const held = deferred(); const repo = repository();
  vi.mocked(repo.save).mockImplementationOnce(async record => { await held.promise; repo.records.set(record.runId, record); });
  const owner = new ScheduleExecutionHistory({ repository: repo, secrets: [] });
  const context = run('two-versions');
  owner.observe({ type: 'run_queued', run: { ...context, job: { ...context.job, action: { kind: 'agent', prompt: 'p'.repeat(SCHEDULE_OBSERVATION_MAX_BYTES / 2) } } } });
  await vi.waitFor(() => expect(repo.save).toHaveBeenCalledOnce());
  owner.observe({ type: 'run_finished', runId: context.runId, jobId: context.jobId, finishedAt: 102, result });
  // Each version is individually smaller than 16 MiB; their combined retained bodies exceed it.
  expect(owner.health()).toMatchObject({ incompleteCompletedRuns: 1, lastRun: { runId: context.runId } });
  expect((await owner.page({ limit: 10 })).runs).toEqual([]);
  held.resolve(); await owner.drain();
  expect((await owner.read({ runId: context.runId }))?.result).toBeUndefined();
  owner.close();
});

it('reserves the active physical in-flight body before admitting later terminal records', async () => {
  const held = deferred(); const repo = repository();
  vi.mocked(repo.save).mockImplementationOnce(async record => { await held.promise; repo.records.set(record.runId, record); });
  const owner = new ScheduleExecutionHistory({ repository: repo, secrets: [] });
  const context = run('active-inflight');
  owner.observe({ type: 'run_queued', run: { ...context, job: { ...context.job, action: { kind: 'agent', prompt: 'p'.repeat(8 * 1024 * 1024) } } } });
  await vi.waitFor(() => expect(repo.save).toHaveBeenCalledOnce());
  settle(owner, 'later-terminal', 'x'.repeat(9 * 1024 * 1024));
  expect((await owner.read({ runId: 'later-terminal' }))?.runId).toBeUndefined();
  expect(owner.health()).toMatchObject({ incompleteCompletedRuns: 1, lastRun: { runId: 'later-terminal' } });
  held.resolve(); await owner.drain();
  settle(owner, 'after-capacity-returns', 'x'.repeat(9 * 1024 * 1024));
  await owner.drain();
  expect(repo.records.get('after-capacity-returns')?.result?.output.length).toBe(9 * 1024 * 1024);
  owner.close();
});

it('does not issue an oversized active snapshot, spin or wait for unsubmitted IO', async () => {
  const repo = repository(); const owner = new ScheduleExecutionHistory({ repository: repo, secrets: [] });
  const context = run('oversized-active');
  owner.observe({ type: 'run_queued', run: { ...context, job: { ...context.job, action: { kind: 'agent', prompt: 'p'.repeat(SCHEDULE_OBSERVATION_MAX_BYTES + 1) } } } });
  await owner.drain();
  expect(repo.save).not.toHaveBeenCalled();
  expect((await owner.read({ runId: context.runId }))?.status).toBe('queued');
  owner.observe({ type: 'run_finished', runId: context.runId, jobId: context.jobId, finishedAt: 102, result });
  await owner.drain();
  expect(repo.save).not.toHaveBeenCalled();
  expect(owner.health().incompleteCompletedRuns).toBe(1);
  owner.close();
});

it('skips a single oversized terminal body without truncating or retaining the business output', async () => {
  const repo = repository(); const owner = new ScheduleExecutionHistory({ repository: repo, secrets: [] });
  const output = 'x'.repeat(SCHEDULE_OBSERVATION_MAX_BYTES + 1);
  settle(owner, 'oversized', output);
  expect(output).toHaveLength(SCHEDULE_OBSERVATION_MAX_BYTES + 1);
  expect(owner.health()).toMatchObject({ incompleteCompletedRuns: 1, lastRun: { runId: 'oversized' } });
  expect((await owner.page({ limit: 10 })).runs).toEqual([]);
  await owner.drain();
  expect((await owner.read({ runId: 'oversized' }))?.result).toBeUndefined();
  owner.close();
});

it('serializes audit and activity through the same writer, preserving phase order and captured identity', async () => {
  const held = deferred(); const effects: string[] = [];
  const owner = new ScheduleExecutionHistory({ secrets: [], auditLogger: { write: async () => { effects.push('audit'); await held.promise; } },
    activity: { publish: async event => { effects.push(`${event.job.id}:${event.phase}`); } } });
  owner.audit({ attempt: attempt('ordered'), record: audit('ordered') });
  for (const phase of ['start', 'finish'] as const) owner.activity({ attempt: attempt('ordered'), event: { phase, job: { ...scheduleFixtureJob, id: 'original-account-job' }, notify: { channel: 'silent' } } });
  expect(effects).toEqual(['audit']);
  held.resolve(); await owner.drain();
  expect(effects).toEqual(['audit', 'original-account-job:start', 'original-account-job:finish']);
  owner.close();
});

it('preserves actual same-scene start/audit/finish order and full activity payload after a held initial write', async () => {
  const held = deferred(); const repo = repository(); const accepted: string[] = [];
  const jobs: unknown[] = [];
  vi.mocked(repo.save).mockImplementationOnce(async record => { await held.promise; repo.records.set(record.runId, record); });
  const owner = new ScheduleExecutionHistory({ repository: repo, secrets: [],
    auditLogger: { write: async record => { accepted.push(`audit:${record.prompt}`); } },
    activity: { publish: async event => { accepted.push(`${event.phase}:${event.job.label}`); jobs.push(event.job); } } });
  const fixture = createScheduleExecutionFixture({ readOnly: true, observations: owner });
  const first = { ...scheduleFixtureJob, label: 'first', action: { kind: 'agent' as const, prompt: 'first' } };
  const second = { ...scheduleFixtureJob, label: 'second', action: { kind: 'agent' as const, prompt: 'second' } };
  try {
    const results = await Promise.all([fixture.worker.run(first), fixture.worker.run(second)]);
    expect(results.map(value => value.success)).toEqual([true, true]);
    expect(accepted).toEqual([]);
    held.resolve(); await owner.drain();
    expect(accepted).toEqual(['start:first', 'audit:first', 'finish:first', 'start:second', 'audit:second', 'finish:second']);
    expect(jobs).toEqual([first, first, second, second]);
  } finally { owner.close(); held.resolve(); await fixture.dispose(); }
});

it('does not publish a queued old-generation activity after close while earlier IO remains hung', async () => {
  const held = deferred(); const publish = vi.fn();
  const owner = new ScheduleExecutionHistory({ secrets: [], auditLogger: { write: () => held.promise }, activity: { publish } });
  owner.audit({ attempt: attempt('old'), record: audit('old') });
  owner.activity({ attempt: attempt('old'), event: { phase: 'finish', job: { ...scheduleFixtureJob, id: 'job' }, notify: { channel: 'silent' } } });
  owner.close();
  expect(owner.health().incompleteCompletedRuns).toBe(1);
  held.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(publish).not.toHaveBeenCalled();
});

it('keeps a lost auxiliary observation visible after later history writes succeed, counting one incomplete run', async () => {
  const repo = repository();
  const owner = new ScheduleExecutionHistory({ repository: repo, secrets: [], auditLogger: { write: async () => { throw new Error('synthetic audit outage'); } } });
  owner.observe({ type: 'run_queued', run: run('aux-gap') });
  owner.observe({ type: 'attempt_started', attempt: attempt('aux-gap') });
  await owner.drain();
  owner.audit({ attempt: attempt('aux-gap'), record: audit('aux-gap') });
  await owner.drain();
  expect(owner.health()).toMatchObject({ activeWriteFailures: 1, incompleteCompletedRuns: 0, lastRun: { runId: 'aux-gap' } });
  owner.observe({ type: 'attempt_progress', ...attempt('aux-gap'), at: 102, phase: 'model', status: 'continued' });
  await owner.drain();
  expect(owner.health().activeWriteFailures).toBe(1); // A history snapshot cannot repair a lost JSONL append.
  owner.audit({ attempt: attempt('aux-gap'), record: audit('aux-gap') });
  await owner.drain();
  owner.observe({ type: 'run_finished', runId: 'aux-gap', jobId: 'job', finishedAt: 104, result });
  await owner.drain();
  expect(owner.health().incompleteCompletedRuns).toBe(1);
  expect((await owner.read({ runId: 'aux-gap' }))?.recordingIssue).toBe(true);
  owner.close();
});

it('reuses exact environment-secret scrubbing and omits inline image bytes across prompt, error and delivery', async () => {
  vi.stubEnv('ZHIN_SYNTHETIC_TEST_TOKEN', 'synthetic-secret-exact-value');
  const repo = repository(); const owner = new ScheduleExecutionHistory({ repository: repo });
  const context = run('redacted');
  const sensitive = 'synthetic-secret-exact-value password=synthetic-pass data:image/png;base64,AAAA';
  owner.observe({ type: 'run_queued', run: { ...context, job: { ...context.job, action: { kind: 'agent', prompt: sensitive } } } });
  owner.observe({ type: 'run_finished', runId: context.runId, jobId: context.jobId, finishedAt: 102,
    result: { ...result, error: sensitive, delivery: { channel: 'im', status: 'unknown', message: sensitive } } });
  await owner.drain();
  const saved = JSON.stringify(repo.records.get(context.runId));
  expect(saved).not.toContain('synthetic-secret-exact-value');
  expect(saved).not.toContain('synthetic-pass');
  expect(saved).not.toContain('data:image');
  expect(saved).toContain('[redacted]');
  owner.close();
});

it('coalesces automatic cleanup with explicit management, and never drains a hung prune on close', async () => {
  const repo = repository(); const held = deferred();
  vi.mocked(repo.prune).mockImplementation(async () => { await held.promise; return 3; });
  const owner = new ScheduleExecutionHistory({ repository: repo, now: () => Date.UTC(2026, 2, 31), secrets: [] });
  owner.housekeeping(); owner.housekeeping();
  const explicit = owner.cleanup();
  expect(repo.prune).toHaveBeenCalledOnce();
  owner.close(); owner.housekeeping();
  expect(repo.prune).toHaveBeenCalledOnce();
  held.resolve();
  expect(await explicit).toEqual({ deleted: 3, cutoff: Date.UTC(2026, 1, 28) });
});
