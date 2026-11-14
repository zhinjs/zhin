/**
 * 读取 zhin.config + .env，连接运行中 Host API（`zhin send` / `zhin watch` / `zhin schedule` 共用）
 */
import path from 'path';
import { resolveHttpConfig } from '@zhin.js/host-http';
import { createConfigDocument } from '@zhin.js/runtime';
import { findConfigFile } from '@zhin.js/gateway/project';
import { loadRuntimeEnvironmentLayers } from '@zhin.js/gateway/project';
import { createLocalGatewayFetch, probeLocalGateway, type LocalGatewayFetch } from '@zhin.js/gateway/local';

export interface HostHttpConfig {
  baseUrl: string;
  token: string;
  /**
   * Set while a gateway runs for the project: requests go over its local control socket
   * (`.zhin/gateway.sock`) as the local owner, so no Console token is needed (ADR 0054 §6).
   */
  fetch?: LocalGatewayFetch;
}

/**
 * A wildcard bind address (`0.0.0.0`, `::`) is where the Host listens, not where a client can
 * connect: map it to the matching loopback so the derived URL stays local. IPv6 literals are bracketed.
 */
export function connectableHost(host: string): string {
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (bare === '0.0.0.0') return '127.0.0.1';
  if (bare === '::' || bare === '::0') return '[::1]';
  return bare.includes(':') ? `[${bare}]` : bare;
}

/**
 * 从项目目录解析 Host API baseUrl 与 Bearer token。
 * Uses the same config document, `.env` + `.env.<environment>` layers and `http` resolver as `zhin runtime start`.
 */
export async function loadHostHttpConfig(
  cwd = process.cwd(),
  environment = process.env.NODE_ENV === 'production' ? 'production' : 'development',
): Promise<HostHttpConfig | null> {
  const configFile = findConfigFile(cwd);
  if (!configFile) return null;

  const layers = await loadRuntimeEnvironmentLayers(cwd, environment);
  const http = await resolveHttpConfig(
    createConfigDocument(path.join(cwd, configFile)),
    layers.environments?.[environment],
    cwd,
  );
  const scheme = http.tls ? 'https' : 'http';
  const host = connectableHost(http.host ?? '127.0.0.1');
  const base = (http.apiBase ?? '/api').replace(/^\/+|\/+$/g, '') || 'api';
  const local = await localGatewayFetch(cwd);
  const consoleToken = process.env.ZHIN_CONSOLE_TOKEN?.trim() || layers.environments?.[environment]?.ZHIN_CONSOLE_TOKEN?.trim() || '';
  return {
    baseUrl: `${scheme}://${host}:${http.port ?? 8086}/${base}`,
    // After Console setup http.token is rejected (ADR 0049): use a user API token instead. Over
    // the local socket only an explicit ZHIN_CONSOLE_TOKEN is sent (the gateway then runs the
    // request as that token's principal); without one the request runs as the local owner.
    token: local ? consoleToken : consoleToken || http.token || '',
    ...(local ? { fetch: local } : {}),
  };
}

/**
 * The local-socket `fetch` when a gateway runs for `root` (any probe failure — not running,
 * another user's socket — leaves the caller on HTTP with its token).
 */
export async function localGatewayFetch(root: string): Promise<LocalGatewayFetch | undefined> {
  const running = await probeLocalGateway({ root }).catch(() => undefined);
  return running ? createLocalGatewayFetch({ root }) : undefined;
}

export interface HostFetchResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

/** 带 Bearer 的 GET（路径相对 baseUrl，如 `/stats`） */
export async function hostGet<T>(
  http: HostHttpConfig,
  apiPath: string,
): Promise<HostFetchResult<T>> {
  return hostFetch(http, apiPath, { method: 'GET' });
}

/** 带 Bearer 的 JSON POST。 */
export async function hostPost<T>(
  http: HostHttpConfig,
  apiPath: string,
  body: unknown,
  timeoutMs = 5_000,
): Promise<HostFetchResult<T>> {
  return hostFetch(http, apiPath, { method: 'POST', body, timeoutMs });
}

async function hostFetch<T>(
  http: HostHttpConfig,
  apiPath: string,
  input: Readonly<{ method: 'GET' | 'POST'; body?: unknown; timeoutMs?: number }>,
): Promise<HostFetchResult<T>> {
  const timeoutMs = input.timeoutMs ?? 5_000;
  const url = `${http.baseUrl}${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`;
  try {
    const res = await (http.fetch ?? fetch)(url, {
      method: input.method,
      headers: {
        ...(http.token ? { Authorization: `Bearer ${http.token}` } : {}),
        ...(input.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      // Host 无响应时超时（默认 5s），避免 watch/send 等命令无限挂起。
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      data?: T;
      error?: string;
      code?: string;
      reason?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: res.status === 401 && !http.fetch
          ? `${body.error ?? 'HTTP 401'}（Console 初始化后 http.token 失效：在 Console 签发 API 令牌并设置 ZHIN_CONSOLE_TOKEN，或先 zhin start 让命令经本地套接字连接网关）`
          : body.error ?? `HTTP ${res.status}`,
      };
    }
    return { ok: true, status: res.status, data: body.data ?? (body as T) };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    const connectionCode = errorCode(e);
    const msg =
      err?.name === 'TimeoutError'
        ? `请求 ${http.baseUrl} 超时（${Math.round(timeoutMs / 1000)}s 无响应）`
        : connectionCode === 'ECONNREFUSED'
          ? `无法连接 ${http.baseUrl}（请先 zhin start）`
          : (err?.message ?? String(e));
    return { ok: false, status: 0, error: msg };
  }
}

function errorCode(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const direct = Reflect.get(value, 'code');
  if (typeof direct === 'string') return direct;
  const cause = Reflect.get(value, 'cause');
  if (!cause || typeof cause !== 'object') return undefined;
  const nested = Reflect.get(cause, 'code');
  return typeof nested === 'string' ? nested : undefined;
}

export interface HostEndpointRow {
  readonly name: string;
  readonly adapter: string;
  readonly status: 'online' | 'offline';
}

interface EndpointPage {
  readonly items?: readonly Partial<HostEndpointRow>[];
  readonly totalPages?: number;
}

const ENDPOINT_PAGE_SIZE = 100;
const ENDPOINT_PAGE_LIMIT = 50;

/** Reads every page of `GET /introspection/endpoints` (paginated as `data.items`). */
export async function listHostEndpoints(
  http: HostHttpConfig,
): Promise<HostFetchResult<HostEndpointRow[]>> {
  const rows: HostEndpointRow[] = [];
  for (let page = 1; page <= ENDPOINT_PAGE_LIMIT; page += 1) {
    const res = await hostGet<EndpointPage>(
      http,
      `/introspection/endpoints?page=${page}&pageSize=${ENDPOINT_PAGE_SIZE}`,
    );
    if (!res.ok) return { ok: false, status: res.status, error: res.error };
    for (const item of res.data?.items ?? []) {
      if (typeof item.name !== 'string' || typeof item.adapter !== 'string') continue;
      rows.push({
        name: item.name,
        adapter: item.adapter,
        status: item.status === 'online' ? 'online' : 'offline',
      });
    }
    if (page >= (res.data?.totalPages ?? 1)) break;
  }
  return { ok: true, status: 200, data: rows };
}
