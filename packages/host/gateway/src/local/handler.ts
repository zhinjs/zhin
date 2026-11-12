/** Maps local socket requests onto the gateway RPC with principal `'local'` (ADR 0054 §6). */
import { GATEWAY_RPC } from '@zhin.js/console-protocol';
import type { GatewayRpcDispatcher } from '../packages/rpc.js';
import type { GatewayPackageService } from '../packages/service.js';
import type { LocalRequestHandler, LocalRequestResult } from './local-socket.js';
import { LOCAL_GATEWAY_RPC, MAX_LOCAL_HTTP_BODY_BYTES, type LocalGatewayHttpResponse, type LocalGatewayInfoResult } from './protocol.js';

export interface LocalRpcHandlerOptions {
  readonly dispatch: GatewayRpcDispatcher;
  /** Progress of package transactions is streamed to the requesting connection. */
  readonly packages?: GatewayPackageService;
  readonly info: () => LocalGatewayInfoResult;
  /** Called after the `gateway.shutdown` answer was queued. */
  readonly shutdown: () => void;
  /** Socket-only `gateway.console.*` (Console setup and user rescue); absent without Console. */
  readonly console?: {
    owns(type: string): boolean;
    handle(type: string, data: unknown): Promise<LocalRequestResult>;
  };
  /**
   * `gateway.http.request`: a `{base}/…` request as the local owner, or — with `token` — as the
   * principal that credential authenticates to; absent → `unavailable`.
   */
  readonly http?: (request: { readonly method: string; readonly path: string; readonly body?: string; readonly token?: string }) => Promise<Response>;
}

const HTTP_METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_TOKEN_CHARS = 4096;
const USE_HTTP = '改用 HTTP 请求（Console API 令牌 ZHIN_CONSOLE_TOKEN，--host 指向网关地址）';

/** UTF-8 bytes `value` takes inside a JSON line (escapes included). */
export function jsonEncodedBytes(value: string): number {
  return Buffer.byteLength(JSON.stringify(value));
}

async function handleHttp(options: LocalRpcHandlerOptions, data: unknown): Promise<LocalRequestResult> {
  const invalid = (message: string): LocalRequestResult => ({ ok: false, error: { code: 'invalid_input', message, status: 400 } });
  if (!options.http) return { ok: false, error: { code: 'unavailable', message: '网关未提供 HTTP 转发', status: 503 } };
  const input = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
  const { method, path, body, token } = input;
  if (typeof method !== 'string' || !HTTP_METHODS.has(method)) return invalid('method 必须是 GET / POST / PUT / PATCH / DELETE');
  // `\` is a path separator to the WHATWG URL parser (`/\evil.com/x` names a host).
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.length > 4096) {
    return invalid('path 必须是以 / 开头、不含 \\ 的路径');
  }
  if (body !== undefined && typeof body !== 'string') return invalid('body 必须是字符串');
  if (body !== undefined && method === 'GET') return invalid('GET 请求不能带 body');
  if (typeof body === 'string' && jsonEncodedBytes(body) > MAX_LOCAL_HTTP_BODY_BYTES) {
    return { ok: false, error: { code: 'invalid_input', message: `请求体超过本地套接字上限；${USE_HTTP}`, status: 413 } };
  }
  if (token !== undefined && (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_CHARS)) return invalid('token 必须是非空字符串');
  const response = await options.http({
    method,
    path,
    ...(body === undefined ? {} : { body }),
    ...(token === undefined ? {} : { token }),
  });
  // A stream (SSE) never ends: one JSON line cannot carry it.
  if (response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, error: { code: 'unavailable', message: `事件流不能经本地套接字转发；${USE_HTTP}`, status: 502 } };
  }
  const text = await response.text();
  if (jsonEncodedBytes(text) > MAX_LOCAL_HTTP_BODY_BYTES) {
    return { ok: false, error: { code: 'unavailable', message: `响应超过本地套接字上限；${USE_HTTP}`, status: 502 } };
  }
  const headers: Record<string, string> = {};
  for (const name of ['content-type', 'retry-after']) {
    const value = response.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  const result: LocalGatewayHttpResponse = { status: response.status, headers, body: text };
  return { ok: true, data: result };
}

const STREAMED: ReadonlySet<string> = new Set([GATEWAY_RPC.INSTALL, GATEWAY_RPC.UNINSTALL, GATEWAY_RPC.UPDATE, GATEWAY_RPC.DECLARE]);

export function createLocalRpcHandler(options: LocalRpcHandlerOptions): LocalRequestHandler {
  return async (request, emit) => {
    if (request.type === LOCAL_GATEWAY_RPC.INFO) return { ok: true, data: options.info() };
    if (request.type === LOCAL_GATEWAY_RPC.SHUTDOWN) {
      setImmediate(options.shutdown);
      return { ok: true, data: { stopping: true } };
    }
    if (options.console?.owns(request.type)) return options.console.handle(request.type, request.data);
    if (request.type === LOCAL_GATEWAY_RPC.HTTP_REQUEST) return handleHttp(options, request.data);
    // One transaction at a time: the first `start` seen after subscribing is this request's.
    let transaction: string | undefined;
    const unsubscribe = STREAMED.has(request.type)
      ? options.packages?.subscribe((event) => {
        if (transaction === undefined && event.type === 'start') transaction = event.id;
        if (event.id === transaction) emit(event);
      })
      : undefined;
    try {
      return await options.dispatch({ type: request.type, data: request.data }, 'local');
    } finally {
      unsubscribe?.();
    }
  };
}
