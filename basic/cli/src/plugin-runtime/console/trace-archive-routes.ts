/**
 * Read-only host-api over the persistent TurnTrace archive (#728 M1.3):
 * sessions → turns → one turn. Requires the `full` auth scope, like the live
 * trace route; every response goes through a redaction pass again.
 */
import { conversationRefKey, type ConversationRef } from '@zhin.js/im-contract';
import type { TurnTrace } from '@zhin.js/agent/trace';
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
        ...mod.resolveTraceArchiveOptions(),
        legacyFile: options.dir ? undefined : mod.defaultTurnTraceFile(projectRoot),
      });
    }
    return { archive, redact: <T>(value: T) => mod!.redactStrings(value) };
  };

  const guarded = (
    handler: (url: URL, response: Parameters<Parameters<HttpHost['route']>[2]>[1]) => Promise<void>,
  ): Parameters<HttpHost['route']>[2] => async (_request, response, url, authScope) => {
    response.setHeader('cache-control', 'no-store');
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
    const conversation = readConversation(url);
    if (conversation === null) return writeJson(response, 400, { success: false, error: '会话地址无效' });
    const limit = parseBoundedInteger(url.searchParams.get('limit'), 100, 1, 500);
    const { archive: store, redact } = await open();
    const traces = (await store.query({ sessionKey, ...window })).filter(trace => matchesConversation(trace, conversation)).slice(-limit);
    // List view: drop the heavy parts; the detail route returns the full trace.
    const rows = traces.map((trace) => ({
      turn_id: trace.turn_id,
      session_key: trace.session_key,
      principal: trace.principal,
      origin: trace.origin,
      usage_calls: traceTree(trace).flatMap(turn => turn.model_calls.map(call => ({ ...call, turn_id: turn.turn_id }))),
      request_count: traceTree(trace).some(turn => turn.requests !== undefined) ? traceTree(trace).reduce((sum, turn) => sum + (turn.requests?.length ?? 0), 0) : undefined,
      context_budget: trace.context_budget,
      started_at: trace.started_at,
      duration_ms: trace.duration_ms,
      model_calls: trace.model_calls.length,
      tool_calls: trace.tool_calls.length,
      total_tokens: trace.usage.total_tokens,
      termination: trace.termination,
    }));
    writeJson(response, 200, { success: true, data: redact(rows.reverse()) });
  }), { summary: 'List persisted Agent turn traces', tags: ['agent', 'trace'] });

  const readTurn = async (url: URL): Promise<TurnTrace | undefined | null> => {
    const turnId = url.searchParams.get('turnId')?.trim() ?? '';
    const sessionKey = url.searchParams.get('sessionKey')?.trim() || undefined;
    const conversation = readConversation(url);
    if (!turnId || turnId.length > 512 || (sessionKey && sessionKey.length > 512) || conversation === null) return null;
    const { archive: store } = await open();
    // Console identities are exact; the CLI's unique-prefix convenience must never select a different turn.
    return (await store.query({ sessionKey })).find(trace => trace.turn_id === turnId && matchesConversation(trace, conversation));
  };

  http.route('GET', `${base}/agent/trace-archive/turn`, guarded(async (url, response) => {
    const trace = await readTurn(url);
    if (trace === null) return writeJson(response, 400, { success: false, error: '请提供有效的回合和会话地址' });
    if (!trace) return writeJson(response, 404, { success: false, error: '找不到该会话的回合' });
    const { redact } = await open();
    writeJson(response, 200, { success: true, data: redact(withoutRequestBodies(trace)) });
  }), { summary: 'Read one persisted Agent turn trace', tags: ['agent', 'trace'] });

  http.route('GET', `${base}/agent/trace-archive/request`, guarded(async (url, response) => {
    const requestId = url.searchParams.get('requestId')?.trim();
    if (!requestId || requestId.length > 1024 || !url.searchParams.get('sessionKey')?.trim()) {
      return writeJson(response, 400, { success: false, error: '请提供请求和会话标识' });
    }
    const trace = await readTurn(url);
    if (trace === null) return writeJson(response, 400, { success: false, error: '请提供有效的回合和会话地址' });
    if (!trace) return writeJson(response, 404, { success: false, error: '找不到该会话的回合' });
    const matches = traceTree(trace).flatMap(turn => (turn.requests ?? [])
      .filter(request => request.request_id === requestId).map(request => ({ turn, request })));
    if (matches.length !== 1) return writeJson(response, 404, { success: false, error: '找不到该回合的请求' });
    const { turn, request } = matches[0]!;
    const { redact } = await open();
    writeJson(response, 200, { success: true, data: redact({ session_key: trace.session_key,
      turn_id: trace.turn_id, request_turn_id: turn.turn_id, request,
      usage: turn.model_calls.find(call => call.request_id === requestId),
    }) });
  }), { summary: 'Read one recorded model input on demand', tags: ['agent', 'trace'] });
}

function traceTree(trace: TurnTrace): TurnTrace[] { return [trace, ...trace.subagents.flatMap(traceTree)]; }
function withoutRequestBodies(trace: TurnTrace): TurnTrace {
  return { ...trace, ...(trace.requests ? { requests: trace.requests.map(({ body: _body, ...request }) => request) } : {}),
    subagents: trace.subagents.map(withoutRequestBodies) };
}
function matchesConversation(trace: TurnTrace, conversation?: ConversationRef): boolean {
  return conversation === undefined || (trace.origin?.kind === 'im' && trace.origin.conversation !== undefined
    && conversationRefKey(trace.origin.conversation) === conversationRefKey(conversation));
}
function readConversation(url: URL): ConversationRef | undefined | null {
  const raw = url.searchParams.get('conversation');
  if (raw === null) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<ConversationRef>;
    const kind = (input: unknown) => ['private', 'group', 'channel'].includes(String(input));
    const text = (input: unknown): input is string => typeof input === 'string' && input.length > 0;
    if (!value || typeof value !== 'object' || !value.endpoint || !text(value.endpoint.adapter) || !text(value.endpoint.id)
      || !kind(value.kind) || !text(value.id) || (value.threadId !== undefined && !text(value.threadId))
      || (value.parent !== undefined && (!value.parent || !kind(value.parent.kind) || !text(value.parent.id)))) return null;
    return { endpoint: { adapter: value.endpoint.adapter, id: value.endpoint.id }, kind: value.kind!, id: value.id,
      ...(value.parent ? { parent: { kind: value.parent.kind, id: value.parent.id } } : {}),
      ...(value.threadId === undefined ? {} : { threadId: value.threadId }) };
  } catch { return null; }
}
