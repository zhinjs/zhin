import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HttpHandler } from '@zhin.js/host-http';
import { FileScheduleHistoryRepository, ScheduleExecutionHistory, type ScheduleRunContext, type ScheduleHistoryResult } from '@zhin.js/agent/runtime';
import { registerScheduleExecutionRoutes } from '../../../src/instance/console/schedule-execution-routes.js';
import { createScheduleExecutionFixture, createFixtureFileWriter, scheduleFixtureJob } from '../../../../agent/tests/helpers/schedule-execution-fixture.js';

const state = vi.hoisted(() => ({ port: undefined as unknown, enabled: true }));
vi.mock('../../../src/instance/console/agent-console.js', () => ({
  withGenerationAgentConsole: async (_snapshots: unknown, run: (value: unknown) => Promise<void>) => {
    if (!state.enabled) return false;
    await run({ assistant: null, scheduleExecutions: state.port });
    return true;
  },
}));
const NOW = Date.UTC(2026, 10, 2, 12);
let directory: string;
let history: ScheduleExecutionHistory;
let repository: FileScheduleHistoryRepository;
let routes: Map<string, HttpHandler>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'zhin-execution-routes-'));
  repository = new FileScheduleHistoryRepository(directory);
  history = new ScheduleExecutionHistory({ repository, now: () => NOW, ownerStartedAt: 1 });
  state.port = history; state.enabled = true; routes = new Map();
  const http = { route: (method: string, path: string, handler: HttpHandler) => { routes.set(`${method} ${path}`, handler); return () => {}; } };
  registerScheduleExecutionRoutes({ http, base: '/api' });
});
afterEach(async () => { await history.drain(); history.close(); await rm(directory, { recursive: true, force: true }); });

async function request(method: string, path: string, auth: 'full' | 'demo' = 'full') {
  const url = new URL(path, 'http://synthetic-host');
  let status = 0;
  let body = '';
  const headers: Record<string, string> = {};
  const response = { setHeader: (name: string, value: string) => { headers[name] = value; },
    writeHead: (code: number, values: Record<string, string>) => { status = code; Object.assign(headers, values); },
    end: (value: string) => { body = value; } };
  const handler = routes.get(`${method} ${url.pathname}`);
  if (!handler) throw new Error('No registered test route');
  await handler({} as never, response as never, url, auth);
  return { status, headers, body: JSON.parse(body) };
}
function context(id: string): ScheduleRunContext {
  return { runId: id, jobId: 'deleted-job', queuedAt: NOW, source: 'manual', job: { id: 'deleted-job', label: 'Captured job title', enabled: true,
    schedule: { kind: 'at', atMs: NOW, deleteAfterRun: true }, action: { kind: 'agent', prompt: 'Synthetic request' }, notify: { channel: 'silent' },
    createdAt: 1, updatedAt: 1, state: {} } };
}
async function seed() {
  const run = context('retained-run');
  const attempt = { runId: run.runId, jobId: run.jobId, attemptId: 'retained-attempt', number: 1, startedAt: NOW + 1 };
  const result: ScheduleHistoryResult = { success: false, output: 'Captured final result', error: 'Synthetic remaining work failed', durationMs: 5,
    tokenUsage: { input: 2, output: 3 }, replay: { disposition: 'unknown', operations: [{ id: 'effect-1', toolName: 'publish', status: 'unknown' }] },
    delivery: { status: 'partial', channel: 'im', messages: [null], deliveryUnknown: true, message: 'One part was submitted; the rest is unconfirmed.' } };
  await history.observe({ type: 'run_queued', run });
  await history.observe({ type: 'attempt_started', attempt });
  await history.observe({ type: 'attempt_progress', runId: run.runId, jobId: run.jobId, attemptId: attempt.attemptId, at: NOW + 2,
    phase: 'tool', status: 'unknown', toolName: 'publish', toolUseId: 'call-1' });
  await history.observe({ type: 'attempt_finished', attempt, finishedAt: NOW + 5, result });
  await history.observe({ type: 'attempt_replay', runId: run.runId, jobId: run.jobId, attemptId: attempt.attemptId, decision: 'stop', reason: 'unknown' });
  await history.observe({ type: 'run_finished', runId: run.runId, jobId: run.jobId, finishedAt: NOW + 5, result });
  await history.drain();
}

it('requires full scope before querying or cleaning, independently of assistant.enabled', async () => {
  const page = vi.spyOn(history, 'page'), cleanup = vi.spyOn(history, 'cleanup');
  expect((await request('GET', '/api/assistant/executions', 'demo')).status).toBe(403);
  expect((await request('POST', '/api/assistant/executions/cleanup', 'demo')).status).toBe(403);
  expect(page).not.toHaveBeenCalled(); expect(cleanup).not.toHaveBeenCalled();
  expect((await request('GET', '/api/assistant/executions')).status).toBe(200);
});

it('reads retained snapshots globally after task deletion, with exact job/run association and a no-store wire response', async () => {
  await seed();
  const page = await request('GET', '/api/assistant/executions?limit=1');
  const detail = await request('GET', '/api/assistant/execution?jobId=deleted-job&runId=retained-run');
  expect(page.headers['cache-control']).toBe('no-store');
  expect(page.body.data.runs[0]).toMatchObject({ label: 'Captured job title', deliveryStatus: 'partial' });
  expect(page.body.data.runs[0]).not.toHaveProperty('result');
  expect(detail.body.data.job.label).toBe('Captured job title');
  expect(detail.body.data.attempts[0].retry).toEqual({ decision: 'stop', reason: 'unknown' });
  expect(detail.body.data.result.delivery).toMatchObject({ status: 'partial', deliveryUnknown: true });
  expect((await request('GET', '/api/assistant/execution?jobId=reused-name&runId=retained-run')).status).toBe(404);
  if (process.env.ZHIN_SCHEDULE_WIRE_CAPTURE) {
    const failed = context('wire-recording-gap');
    const write = vi.spyOn(repository, 'save').mockRejectedValue(new Error('synthetic recording gap'));
    history.observe({ type: 'run_queued', run: failed });
    await history.drain();
    history.observe({ type: 'run_finished', runId: failed.runId, jobId: failed.jobId, finishedAt: NOW + 1,
      result: { success: true, output: 'Unpersisted synthetic result', durationMs: 1, tokenUsage: { input: 0, output: 0 } } });
    await history.drain();
    write.mockRestore();
    const withGap = await request('GET', '/api/assistant/executions?limit=1');
    await writeFile(process.env.ZHIN_SCHEDULE_WIRE_CAPTURE, JSON.stringify({ pageResponse: withGap.body, detailResponse: detail.body }, null, 2));
  }
});

it('rejects malformed cursors and keeps storage failure distinct from missing or empty history', async () => {
  expect((await request('GET', '/api/assistant/executions?cursor=bad')).status).toBe(400);
  expect((await request('GET', '/api/assistant/execution')).status).toBe(400);
  expect((await request('GET', '/api/assistant/execution?runId=missing')).status).toBe(404);
  vi.spyOn(repository, 'page').mockRejectedValue(new Error('PRIVATE_STORAGE_CONTENT'));
  const failed = await request('GET', '/api/assistant/executions');
  expect(failed.status).toBe(503);
  expect(JSON.stringify(failed.body)).not.toContain('PRIVATE_STORAGE_CONTENT');
  expect(failed.body).not.toHaveProperty('data.runs');
});

it('exposes terminal recording health without retaining failed output or presenting missing data as no execution', async () => {
  vi.spyOn(repository, 'save').mockRejectedValue(new Error('synthetic disk outage'));
  const run = context('missing-run');
  history.observe({ type: 'run_queued', run });
  await history.drain();
  history.observe({ type: 'run_finished', runId: run.runId, jobId: run.jobId, finishedAt: NOW + 1,
    result: { success: true, output: 'FAILED_BODY', durationMs: 1, tokenUsage: { input: 0, output: 0 } } });
  await history.drain();
  const page = await request('GET', '/api/assistant/executions');
  expect(page.body.data.recordingHealth).toMatchObject({ activeWriteFailures: 0, incompleteCompletedRuns: 1, lastRun: { runId: 'missing-run' } });
  expect(page.body.data.runs).toEqual([]);
  const detail = await request('GET', '/api/assistant/execution?runId=missing-run');
  expect(detail.status).toBe(503);
  expect(detail.body.code).toBe('schedule_history_incomplete');
  expect(JSON.stringify(detail.body)).not.toContain('FAILED_BODY');
});

it('cleans only expired inactive executions and returns the actual calendar cutoff', async () => {
  await seed();
  const response = await request('POST', '/api/assistant/executions/cleanup');
  expect(response.status).toBe(200);
  expect(response.body.data).toEqual({ deleted: 0, cutoff: Date.UTC(2026, 9, 2, 12) });
  expect((await request('GET', '/api/assistant/execution?runId=retained-run')).status).toBe(200);
});

it('exports repository-derived multi-attempt, committed-stop, pagination and cleanup wire scenarios', async () => {
  const successful: ScheduleHistoryResult = { success: true, output: 'Verified second-attempt result', durationMs: 8,
    tokenUsage: { input: 5, output: 6 }, replay: { disposition: 'safe', operations: [] }, delivery: { status: 'not_requested', channel: 'silent' } };
  const completed = async (run: ScheduleRunContext, result: ScheduleHistoryResult) => {
    const attempt = { runId: run.runId, jobId: run.jobId, attemptId: `${run.runId}-attempt`, number: 1, startedAt: run.queuedAt + 1 };
    await history.observe({ type: 'run_queued', run });
    await history.observe({ type: 'attempt_started', attempt });
    await history.observe({ type: 'attempt_finished', attempt, finishedAt: run.queuedAt + 10, result });
    if (!result.success) await history.observe({ type: 'attempt_replay', runId: run.runId, jobId: run.jobId, attemptId: attempt.attemptId,
      decision: 'stop', reason: 'committed' });
    await history.observe({ type: 'run_finished', runId: run.runId, jobId: run.jobId, finishedAt: run.queuedAt + 10, result });
    await history.drain();
  };
  await seed();
  const retryRun = { ...context('two-attempts'), queuedAt: NOW - 1 };
  await history.observe({ type: 'run_queued', run: retryRun });
  for (const number of [1, 2]) {
    const attempt = { runId: retryRun.runId, jobId: retryRun.jobId, attemptId: `retry-attempt-${number}`, number, startedAt: NOW + number };
    await history.observe({ type: 'attempt_started', attempt });
    await history.observe({ type: 'attempt_progress', runId: retryRun.runId, jobId: retryRun.jobId, attemptId: attempt.attemptId,
      at: NOW + number + 1, phase: 'tool', status: number === 1 ? 'failed' : 'completed', toolName: 'read_record', toolUseId: `read-${number}` });
    await history.observe({ type: 'attempt_finished', attempt, finishedAt: NOW + number + 2,
      result: number === 1 ? { ...successful, success: false, status: 'failed', output: '', error: 'Synthetic read failed' } : successful });
    if (number === 1) await history.observe({ type: 'attempt_replay', runId: retryRun.runId, jobId: retryRun.jobId, attemptId: attempt.attemptId,
      decision: 'retry', reason: 'read_only' });
  }
  await history.observe({ type: 'run_finished', runId: retryRun.runId, jobId: retryRun.jobId, finishedAt: NOW + 5, result: successful });
  await completed({ ...context('committed-stop'), queuedAt: NOW - 2 }, { ...successful, success: false, status: 'failed',
    output: 'The earlier write completed; later verification failed.', error: 'Synthetic later read failed',
    replay: { disposition: 'committed', operations: [{ id: 'write-1', status: 'committed', toolName: 'publish' }] } });
  await completed({ ...context('older-run'), queuedAt: NOW - 3 }, successful);
  await completed({ ...context('expired-run'), queuedAt: Date.UTC(2026, 8, 1) }, successful);
  if (process.env.ZHIN_SCHEDULE_WIRE_CAPTURE) {
    for (let index = 0; index < 51; index++) await completed({ ...context(`older-synthetic-${index}`), queuedAt: NOW - 1_000 - index }, successful);
  }
  const pagesFor = async (limit: number) => {
    const pages: Array<{ cursor: string | null; response: unknown }> = [];
    let cursor: string | null = null;
    do {
      const page = await request('GET', `/api/assistant/executions?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      pages.push({ cursor, response: page.body }); cursor = page.body.data.nextCursor;
    } while (cursor);
    return pages;
  };
  const pages = await pagesFor(2);
  const browserPages = await pagesFor(50);
  const partial = await request('GET', '/api/assistant/execution?runId=retained-run');
  const twoAttempts = await request('GET', '/api/assistant/execution?runId=two-attempts');
  const committed = await request('GET', '/api/assistant/execution?runId=committed-stop');
  expect(twoAttempts.body.data.attempts).toHaveLength(2);
  expect(committed.body.data.attempts[0].retry).toEqual({ decision: 'stop', reason: 'committed' });
  const cleanup = await request('POST', '/api/assistant/executions/cleanup');
  expect(cleanup.body.data.deleted).toBe(1);
  expect((await request('GET', '/api/assistant/execution?runId=expired-run')).status).toBe(404);
  const afterCleanup = await request('GET', '/api/assistant/executions?limit=2');
  const afterCleanupPages = await pagesFor(50);
  const capture = process.env.ZHIN_SCHEDULE_WIRE_CAPTURE;
  if (capture) {
    const existing = JSON.parse(await readFile(capture, 'utf8'));
    await writeFile(capture, JSON.stringify({ ...existing, browser: { pageResponses: browserPages, afterCleanupPageResponses: afterCleanupPages,
      details: { 'retained-run': partial.body, 'two-attempts': twoAttempts.body, 'committed-stop': committed.body }, cleanupResponse: cleanup.body }, scenarioResponses: {
      pages, partial: partial.body, twoAttempts: twoAttempts.body, committed: committed.body, cleanup: cleanup.body, afterCleanup: afterCleanup.body,
    } }, null, 2));
  }
});

it('captures actual Worker, Executor, Domain and TurnToolRuntime producers through the repository and registered Host handler', async () => {
  const readonly = createScheduleExecutionFixture({ readOnly: true, failAfterTool: true, observations: history });
  const committed = createScheduleExecutionFixture({ tool: createFixtureFileWriter(), workspace: directory, failAfterTool: true, observations: history });
  try {
    const readResult = await readonly.worker.run({ ...scheduleFixtureJob, id: 'actual-read-only', label: 'Actual read-only retry' });
    const writeResult = await committed.worker.run({ ...scheduleFixtureJob, id: 'actual-committed', label: 'Actual committed write' });
    await history.drain();
    expect(readResult.success).toBe(true);
    expect(readonly.turns()).toBe(2);
    expect(writeResult.success).toBe(false);
    expect(committed.turns()).toBe(1);
    expect(await readFile(join(directory, 'result.txt'), 'utf8')).toBe('Confirmed filesystem mutation');
    const readPage = await request('GET', '/api/assistant/executions?jobId=actual-read-only');
    const committedPage = await request('GET', '/api/assistant/executions?jobId=actual-committed');
    const readRunId = readPage.body.data.runs[0].runId;
    const writeRunId = committedPage.body.data.runs[0].runId;
    const readDetail = await request('GET', `/api/assistant/execution?jobId=actual-read-only&runId=${encodeURIComponent(readRunId)}`);
    const writeDetail = await request('GET', `/api/assistant/execution?jobId=actual-committed&runId=${encodeURIComponent(writeRunId)}`);
    expect(readDetail.body.data.attempts).toHaveLength(2);
    expect(readDetail.body.data.attempts[0].retry).toEqual({ decision: 'retry', reason: 'read_only' });
    expect(writeDetail.body.data.attempts).toHaveLength(1);
    expect(writeDetail.body.data.attempts[0].retry).toEqual({ decision: 'stop', reason: 'committed' });
    expect(writeDetail.body.data.result.replay.disposition).toBe('committed');
    expect(writeDetail.body.data.attempts[0].progress).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'tool', toolName: 'fixture_file_writer' }),
    ]));
    const capture = process.env.ZHIN_SCHEDULE_WIRE_CAPTURE;
    if (capture) {
      const existing = JSON.parse(await readFile(capture, 'utf8'));
      await writeFile(capture, JSON.stringify({ ...existing, actualProducer: {
        readOnly: { pageResponse: readPage.body, detailResponse: readDetail.body, turns: readonly.turns(), effects: readonly.effects() },
        committed: { pageResponse: committedPage.body, detailResponse: writeDetail.body, turns: committed.turns(), fileContents: 'Confirmed filesystem mutation' },
      } }, null, 2));
    }
  } finally {
    await readonly.dispose();
    await committed.dispose();
  }
});
