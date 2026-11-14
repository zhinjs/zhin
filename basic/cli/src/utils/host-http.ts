/**
 * 读取 zhin.config + .env，连接运行中 Host API（`zhin send` / `zhin watch` / `zhin schedule` 共用）
 */
import path from 'path';
import { resolveHttpConfig } from '@zhin.js/host-http';
import { createConfigDocument } from '@zhin.js/runtime';
import { findConfigFile, loadRuntimeEnvironmentLayers, projectIdentity } from '@zhin.js/gateway/project';
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

/** Why the CLI refused to pick a Host for this project (#1250); nothing was sent. */
export class HostTargetError extends Error {
  constructor(readonly code: 'gateway-not-running' | 'project-mismatch' | 'invalid-host', message: string) {
    super(message);
    this.name = 'HostTargetError';
  }
}

/** The message when this project's gateway is not running; `offline` mentions `--offline` (zhin config). */
export function gatewayNotRunningMessage(options: { offline?: boolean } = {}): string {
  return `本项目的网关未运行（zhin start 启动${options.offline ? '，或加 --offline 离线读写配置文件' : ''}）；`
    + '未向任何地址发送请求。确需连接其他地址的 Host 时请显式 --host <url>';
}

export interface LoadHostHttpOptions {
  /**
   * An explicit Host URL (`--host`). Without it only this project's own gateway — over its local
   * control socket — is used: the CLI never derives `http://127.0.0.1:<port>` from the
   * configuration, where another project's gateway may be listening (#1250).
   */
  readonly host?: string;
  /** `fetch` used for the `/pub/health` identity check (tests). */
  readonly fetch?: typeof fetch;
  /** Where the identity-check warning goes (default stderr). */
  readonly warn?: (message: string) => void;
}

/** `http://host:port` → `http://host:port/api`; refuses credentials, query and fragment. */
export function normalizeHostUrl(host: string): string {
  let url: URL;
  try { url = new URL(host); } catch { throw new HostTargetError('invalid-host', `无效的 --host 地址：${host}`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new HostTargetError('invalid-host', '--host 必须是不带凭据、查询和片段的 HTTP(S) 地址');
  }
  const path = url.pathname === '/' ? '/api' : url.pathname.replace(/\/+$/u, '');
  return `${url.origin}${path}`;
}

export function isLoopbackUrl(value: string): boolean {
  const hostname = new URL(value).hostname;
  return hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/u.test(hostname);
}

/**
 * Before a request (and a Console token) goes to an explicit `--host` on this machine: the gateway
 * there must report this project's id on `/pub/health`. A different id is refused; a gateway that
 * reports none (older versions, a `--standalone` instance) is accepted with a warning. Remote hosts
 * are not checked: the operator named them explicitly and they cannot share this checkout's path.
 */
export async function verifyHostProject(baseUrl: string, projectRoot: string, options: Pick<LoadHostHttpOptions, 'fetch' | 'warn'> = {}): Promise<void> {
  if (!isLoopbackUrl(baseUrl)) return;
  const origin = new URL(baseUrl).origin;
  const warn = options.warn ?? ((message: string) => console.error(message));
  let reported: unknown;
  try {
    const response = await (options.fetch ?? fetch)(`${origin}/pub/health`, { signal: AbortSignal.timeout(3_000), redirect: 'error' });
    const body = (await response.json().catch(() => undefined)) as { project?: { id?: unknown } } | undefined;
    reported = body?.project?.id;
  } catch {
    return; // Unreachable: the request itself reports the connection failure.
  }
  if (typeof reported !== 'string') {
    warn(`! ${origin} 没有报告项目标识（旧版网关或 --standalone 实例），无法确认它属于本项目`);
    return;
  }
  const expected = projectIdentity(projectRoot);
  if (reported !== expected) {
    throw new HostTargetError('project-mismatch',
      `${origin} 上运行的是另一个项目的网关（项目标识 ${reported.slice(0, 12)}…，本项目 ${expected.slice(0, 12)}…）；已拒绝，未发送请求和令牌。`
      + '请在那个项目的目录里执行，或先 zhin start 启动本项目的网关');
  }
}

/**
 * 从项目目录解析 Host API 连接：本项目网关运行时经本地控制套接字（`.zhin/gateway.sock`）；
 * 显式 `--host` 时连该地址（本机地址先核对项目标识）；否则抛出 {@link HostTargetError}，
 * 不再按配置推导 `127.0.0.1:<port>` 并带上令牌（#1250）。返回 null 表示不是 zhin 项目目录。
 */
export async function loadHostHttpConfig(
  cwd = process.cwd(),
  environment = process.env.NODE_ENV === 'production' ? 'production' : 'development',
  options: LoadHostHttpOptions = {},
): Promise<HostHttpConfig | null> {
  const configFile = findConfigFile(cwd);
  if (!configFile) return null;

  const layers = await loadRuntimeEnvironmentLayers(cwd, environment);
  const consoleToken = process.env.ZHIN_CONSOLE_TOKEN?.trim() || layers.environments?.[environment]?.ZHIN_CONSOLE_TOKEN?.trim() || '';
  if (options.host) {
    const baseUrl = normalizeHostUrl(options.host);
    await verifyHostProject(baseUrl, cwd, options);
    // After Console setup http.token is rejected (ADR 0049): use a user API token instead.
    const http = await resolveHttpConfig(createConfigDocument(path.join(cwd, configFile)), layers.environments?.[environment], cwd);
    return { baseUrl, token: consoleToken || http.token || '' };
  }
  const local = await localGatewayFetch(cwd);
  if (!local) throw new HostTargetError('gateway-not-running', gatewayNotRunningMessage());
  const http = await resolveHttpConfig(createConfigDocument(path.join(cwd, configFile)), layers.environments?.[environment], cwd);
  const scheme = http.tls ? 'https' : 'http';
  const host = connectableHost(http.host ?? '127.0.0.1');
  const base = (http.apiBase ?? '/api').replace(/^\/+|\/+$/g, '') || 'api';
  return {
    // Only a label and the URL path over the socket: no TCP connection is made to it.
    baseUrl: `${scheme}://${host}:${http.port ?? 8086}/${base}`,
    // Over the local socket only an explicit ZHIN_CONSOLE_TOKEN is sent (the gateway then runs the
    // request as that token's principal); without one the request runs as the local owner.
    token: consoleToken,
    fetch: local,
  };
}

/** `--host <url>` help text shared by the commands that talk to a running Host. */
export const HOST_OPTION_DESCRIPTION = '显式连接这个 Host 地址（默认只经本项目网关的本地套接字连接；本机地址会先核对项目标识）';

/**
 * {@link loadHostHttpConfig} for commands: reports a missing project or a refused target through
 * `report` and exits 1 — nothing is sent in either case.
 */
export async function requireHostHttpConfig(
  options: { host?: string },
  report: (message: string) => void,
  cwd = process.cwd(),
): Promise<HostHttpConfig> {
  try {
    const http = await loadHostHttpConfig(cwd, undefined, options.host ? { host: options.host } : {});
    if (http) return http;
    report('未找到 zhin 配置文件，无法确定 Host API 地址');
  } catch (error) {
    if (!(error instanceof HostTargetError)) throw error;
    report(error.message);
  }
  process.exit(1);
}

/**
 * The local-socket `fetch` when a gateway runs for `root`; undefined otherwise (not running,
 * another user's socket). Callers must not fall back to a TCP port derived from the config.
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
  /** Classified failure (`ConsoleApiErrorCode`, #1250); absent for transport errors and older instances. */
  code?: string;
  /** Log correlation id of an unexpected instance failure (`code: 'internal_error'`). */
  errorId?: string;
  /** Structured detail of an expected failure (e.g. a `ConsoleSendFailure`). */
  detail?: unknown;
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
): Promise<HostFetchResult<T>> {
  return hostFetch(http, apiPath, { method: 'POST', body });
}

async function hostFetch<T>(
  http: HostHttpConfig,
  apiPath: string,
  input: Readonly<{ method: 'GET' | 'POST'; body?: unknown }>,
): Promise<HostFetchResult<T>> {
  const url = `${http.baseUrl}${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`;
  try {
    const res = await (http.fetch ?? fetch)(url, {
      method: input.method,
      headers: {
        ...(http.token ? { Authorization: `Bearer ${http.token}` } : {}),
        ...(input.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      // Host 无响应时 5s 超时，避免 watch/send 等命令无限挂起。
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      data?: T;
      error?: string;
      code?: unknown;
      errorId?: unknown;
    };
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        ...(typeof body.code === 'string' ? { code: body.code } : {}),
        ...(typeof body.errorId === 'string' ? { errorId: body.errorId } : {}),
        ...(body.data !== undefined ? { detail: body.data } : {}),
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
        ? `请求 ${http.baseUrl} 超时（5s 无响应）`
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
