/**
 * Read-only host-api over the persistent TurnTrace archive (#728 M1.3):
 * sessions → turns → one turn. Requires the `full` auth scope, like the live
 * trace route; every response goes through a redaction pass again.
 */
import type { HttpHost } from '@zhin.js/host-http';
import { parseBoundedInteger, writeJson } from './http-response.js';

export interface RegisterTraceArchiveRoutesOptions {
  readonly http: HttpHost;
  readonly base: string;
  readonly projectRoot: string;
  /** Test seam: archive directory (default `<projectRoot>/data/agent-traces`). */
  readonly dir?: string;
}

type TraceModule = typeof import('@zhin.js/agent/trace');

function optionalTime(value: string | null): number | undefined | null {
  if (value === null || value.trim() === '') return undefined;
  const parsed = /^\d+$/.test(value.trim()) ? Number(value) : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function registerTraceArchiveRoutes(options: RegisterTraceArchiveRoutesOptions): void {
  const { http, base, projectRoot } = options;
  let archive: ReturnType<TraceModule['createTurnTraceArchive']> | undefined;
  let mod: TraceModule | undefined;

  const open = async () => {
    if (!archive) {
      mod = await import('@zhin.js/agent/trace');
      archive = mod.createTurnTraceArchive(options.dir ?? mod.defaultTurnTraceDir(projectRoot), {
        legacyFile: options.dir ? undefined : mod.defaultTurnTraceFile(projectRoot),
      });
    }
    return { archive, redact: <T>(value: T) => mod!.redactStrings(value) };
  };

  const guarded = (
    handler: (url: URL, response: Parameters<Parameters<HttpHost['route']>[2]>[1]) => Promise<void>,
  ): Parameters<HttpHost['route']>[2] => async (_request, response, url, authScope) => {
    if (authScope !== 'full') {
      writeJson(response, 403, { success: false, error: '需要 full scope 才能读取 Agent Trace' });
      return;
    }
    try {
      await handler(url, response);
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException)?.code === 'ERR_MODULE_NOT_FOUND';
      writeJson(response, missing ? 503 : 500, {
        success: false,
        error: missing ? '未安装 @zhin.js/agent，无法读取 trace' : 'trace 读取失败',
      });
    }
  };

  const range = (url: URL) => {
    const since = optionalTime(url.searchParams.get('since'));
    const until = optionalTime(url.searchParams.get('until'));
    return since === null || until === null ? null : { since, until };
  };

  http.route('GET', `${base}/agent/trace-archive/sessions`, guarded(async (url, response) => {
    const window = range(url);
    if (!window) return writeJson(response, 400, { success: false, error: 'since / until 必须是 ISO 时间或毫秒时间戳' });
    const { archive: store, redact } = await open();
    writeJson(response, 200, { success: true, data: redact(await store.sessions(window)) });
  }), { summary: 'List sessions with persisted Agent turn traces', tags: ['agent', 'trace'] });

  http.route('GET', `${base}/agent/trace-archive/turns`, guarded(async (url, response) => {
    const window = range(url);
    if (!window) return writeJson(response, 400, { success: false, error: 'since / until 必须是 ISO 时间或毫秒时间戳' });
    const sessionKey = url.searchParams.get('sessionKey')?.trim() || undefined;
    if (sessionKey && sessionKey.length > 512) return writeJson(response, 400, { success: false, error: 'sessionKey 过长' });
    const limit = parseBoundedInteger(url.searchParams.get('limit'), 100, 1, 500);
    const { archive: store, redact } = await open();
    const traces = await store.query({ sessionKey, ...window, limit });
    // List view: drop the heavy parts; the detail route returns the full trace.
    const rows = traces.map((trace) => ({
      turn_id: trace.turn_id,
      session_key: trace.session_key,
      principal: trace.principal,
      started_at: trace.started_at,
      duration_ms: trace.duration_ms,
      model_calls: trace.model_calls.length,
      tool_calls: trace.tool_calls.length,
      total_tokens: trace.usage.total_tokens,
      termination: trace.termination,
    }));
    writeJson(response, 200, { success: true, data: redact(rows.reverse()) });
  }), { summary: 'List persisted Agent turn traces', tags: ['agent', 'trace'] });

  http.route('GET', `${base}/agent/trace-archive/turn`, guarded(async (url, response) => {
    const turnId = url.searchParams.get('turnId')?.trim() ?? '';
    if (!turnId || turnId.length > 512) return writeJson(response, 400, { success: false, error: '请提供有效的 turnId 查询参数' });
    const { archive: store, redact } = await open();
    const trace = await store.find(turnId);
    if (!trace) return writeJson(response, 404, { success: false, error: `找不到回合 ${turnId}` });
    writeJson(response, 200, { success: true, data: redact(trace) });
  }), { summary: 'Read one persisted Agent turn trace', tags: ['agent', 'trace'] });
}
