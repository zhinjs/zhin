import type { HttpHost } from '@zhin.js/host-http';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import type { ScheduleHistoryCursor, ScheduleExecutionHistoryPort } from '@zhin.js/agent/runtime';
import { withGenerationAgentConsole } from './agent-console.js';
import { parseBoundedInteger, writeJson } from '@zhin.js/gateway/http';

interface ScheduleExecutionRoutesOptions { readonly http: Pick<HttpHost, 'route'>; readonly base: string; readonly snapshots?: SnapshotReader }
function decodeCursor(value: string | null): ScheduleHistoryCursor | undefined {
  if (value === null) return undefined;
  const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<ScheduleHistoryCursor>;
  if (typeof cursor.queuedAt !== 'number' || !Number.isSafeInteger(cursor.queuedAt) || cursor.queuedAt < 0 || typeof cursor.key !== 'string' || !/^[a-f0-9]{64}$/u.test(cursor.key)) {
    throw new Error('Invalid execution cursor');
  }
  return { queuedAt: cursor.queuedAt, key: cursor.key };
}

/** Same generation and full-scope boundary as sensitive Agent trace reads; these routes never execute jobs. */
export function registerScheduleExecutionRoutes({ http, base, snapshots }: ScheduleExecutionRoutesOptions): void {
  const guarded = (operation: (store: ScheduleExecutionHistoryPort, url: URL) => Promise<unknown>): Parameters<HttpHost['route']>[2] =>
    async (_request, response, url, authScope) => {
      response.setHeader('cache-control', 'no-store');
      if (authScope !== 'full') return writeJson(response, 403, { success: false, error: '需要登录 Console 才能访问执行记录' });
      try {
        const handled = await withGenerationAgentConsole(snapshots, async ({ scheduleExecutions }) => {
          if (!scheduleExecutions) return writeJson(response, 503, { success: false, code: 'schedule_history_unavailable', error: '执行记录尚未就绪' });
          const data = await operation(scheduleExecutions, url);
          if (data === undefined) {
            const health = scheduleExecutions.health();
            const incomplete = health.incompleteCompletedRuns > 0 && health.lastRun?.runId === url.searchParams.get('runId')
              && (!url.searchParams.has('jobId') || health.lastRun?.jobId === url.searchParams.get('jobId'));
            writeJson(response, incomplete ? 503 : 404, { success: false,
              code: incomplete ? 'schedule_history_incomplete' : 'schedule_history_not_found',
              error: incomplete ? '该次执行记录未完整保存' : '找不到该任务的执行记录', recordingHealth: health });
          }
          else writeJson(response, 200, { success: true, data });
        });
        if (!handled) writeJson(response, 503, { success: false, code: 'schedule_history_unavailable', error: '执行记录尚未就绪' });
      } catch (error) {
        if (error instanceof InvalidHistoryQuery) writeJson(response, 400, { success: false, code: 'invalid_execution_query', error: error.message });
        else writeJson(response, 503, { success: false, code: 'schedule_history_unavailable', error: '执行记录暂时无法读取，请稍后重试' });
      }
    };
  const job = (url: URL): string | undefined => {
    const value = url.searchParams.get('jobId');
    if (value !== null && !value.trim()) throw new InvalidHistoryQuery('jobId 不能为空');
    return value ?? undefined;
  };
  http.route('GET', `${base}/assistant/executions`, guarded(async (store, url) => {
    let before: ScheduleHistoryCursor | undefined;
    try { before = decodeCursor(url.searchParams.get('cursor')); }
    catch { throw new InvalidHistoryQuery('执行记录游标无效'); }
    const page = await store.page({ jobId: job(url), before, limit: parseBoundedInteger(url.searchParams.get('limit'), 100, 1, 500) });
    return { runs: page.runs, recordingHealth: page.recordingHealth, nextCursor: page.nextCursor ? Buffer.from(JSON.stringify(page.nextCursor)).toString('base64url') : null };
  }), { summary: 'List scheduled execution history', tags: ['assistant'] });
  http.route('GET', `${base}/assistant/execution`, guarded(async (store, url) => {
    const runId = url.searchParams.get('runId');
    if (!runId?.trim()) throw new InvalidHistoryQuery('请提供有效的 runId');
    return store.read({ runId, jobId: job(url) });
  }), { summary: 'Read one scheduled execution and its attempts', tags: ['assistant'] });
  http.route('POST', `${base}/assistant/executions/cleanup`, guarded(store => store.cleanup()),
    { summary: 'Delete expired inactive execution history', tags: ['assistant'] });
}

class InvalidHistoryQuery extends Error {}
