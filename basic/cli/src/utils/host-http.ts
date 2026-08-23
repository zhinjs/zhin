/**
 * 读取 zhin.config + .env，连接运行中 Host API（与 `zhin send` 一致）
 */
import fs from 'fs-extra';
import path from 'path';
import yaml from 'yaml';

const CONFIG_CANDIDATES = [
  'config.yml', 'config.yaml', 'config.json',
  'zhin.config.yml', 'zhin.config.yaml', 'zhin.config.json',
];

export interface HostHttpConfig {
  baseUrl: string;
  token: string;
}

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function findConfigFile(dir: string): string | null {
  return CONFIG_CANDIDATES.find((f) => fs.existsSync(path.join(dir, f))) ?? null;
}

async function readConfig(filePath: string): Promise<Record<string, unknown>> {
  const content = await fs.readFile(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();
  return (ext === '.json' ? JSON.parse(content) : yaml.parse(content)) as Record<string, unknown>;
}

function resolveEnvRef(value: string, env: Record<string, string>): string {
  if (value.startsWith('${') && value.endsWith('}')) {
    const key = value.slice(2, -1).trim();
    return env[key] ?? process.env[key] ?? '';
  }
  return value;
}

/** 从项目目录解析 Host API baseUrl 与 Bearer token */
export async function loadHostHttpConfig(cwd = process.cwd()): Promise<HostHttpConfig | null> {
  const configFile = findConfigFile(cwd);
  if (!configFile) return null;

  const config = await readConfig(path.join(cwd, configFile));
  const http = (config?.http ?? {}) as Record<string, unknown>;
  const port = (http.port as number | undefined) ?? 8086;
  const host = String(http.host ?? '127.0.0.1');
  const base = String(http.base ?? '/api').replace(/^\/+|\/+$/g, '') || 'api';
  const baseUrl = `http://${host}:${port}/${base}`;

  const envPath = path.join(cwd, '.env');
  const env = fs.existsSync(envPath) ? parseEnv(await fs.readFile(envPath, 'utf-8')) : {};

  let token = String(http.token ?? '');
  token = resolveEnvRef(token, env);

  return { baseUrl, token };
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
    const res = await fetch(url, {
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
    };
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: body.error ?? `HTTP ${res.status}`,
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
          ? `无法连接 ${http.baseUrl}（请先 zhin runtime start）`
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
