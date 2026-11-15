/**
 * Runtime state for the terminal (#1250 `doctor-blind-to-runtime-health`): adapter accounts
 * (`endpoint.list`), MCP servers (`GET /introspection/mcp`) and the attention inbox
 * (`attention.list`), read through this project's gateway over its local control socket (as the
 * local owner). Every read has a deadline; a read that fails or times out is reported as
 * 「无法读取」 and never fails `zhin status` / `zhin doctor` on its own.
 *
 * Without a running gateway, `.zhin/runtime-failures.json` (the instance's failure journal) tells
 * what failed during the last run.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ATTENTION_RPC, ENDPOINT_RPC,
  type ConsoleAttentionItem, type ConsoleAttentionList, type ConsoleEndpointSummary, type ConsoleMcpServerRow,
} from '@zhin.js/console-protocol';
import { hostGet, hostPost, loadHostHttpConfig, type HostFetchResult, type HostHttpConfig } from './host-http.js';

/** Deadline of each runtime read (connect + answer). */
export const RUNTIME_READ_TIMEOUT_MS = 5_000;

export type RuntimeRead<T> =
  | { readonly available: true; readonly items: readonly T[] }
  | { readonly available: false; readonly error: string };

export interface RuntimeEndpoint {
  readonly adapter: string;
  readonly name: string;
  readonly status: 'online' | 'offline';
  readonly phase?: string;
  readonly transport?: string;
  readonly lastError?: string;
}

export interface RuntimeMcpServer {
  readonly name: string;
  readonly status: 'connected' | 'failed' | 'idle' | 'not_loaded' | 'disconnected';
  readonly toolCount: number;
  readonly lastError?: string;
}

export interface RuntimeAttentionItem {
  readonly kind: string;
  readonly severity: string;
  readonly title: string;
  readonly detail: string;
  readonly source: string;
}

export type RuntimeAttention =
  | {
    readonly available: true;
    readonly items: readonly RuntimeAttentionItem[];
    /** Sources that could not be read (the list is incomplete for them), with reasons when known. */
    readonly unavailable: readonly { readonly source: string; readonly reason?: string }[];
  }
  | { readonly available: false; readonly error: string };

export interface RuntimeState {
  readonly endpoints: RuntimeRead<RuntimeEndpoint>;
  readonly mcp: RuntimeRead<RuntimeMcpServer>;
  readonly attention: RuntimeAttention;
}

/** Resolves `work`, or rejects with a timeout after `ms` (the socket connect itself has no signal). */
export async function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what}超时（${Math.round(ms / 1000)}s 无响应）`)), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function failed<T>(result: HostFetchResult<T>): string {
  return result.error ?? `HTTP ${result.status}`;
}

async function readRpc<T>(http: HostHttpConfig, type: string, data: Record<string, unknown>, timeoutMs: number): Promise<T> {
  const result = await withDeadline(
    hostPost<T>(http, '/console/request', { type, data, requestId: `cli-status-${type}` }, timeoutMs),
    timeoutMs + 500, type,
  );
  if (!result.ok || result.data === undefined) throw new Error(failed(result));
  return result.data;
}

function endpointRow(row: Partial<ConsoleEndpointSummary>): RuntimeEndpoint | undefined {
  if (typeof row.name !== 'string' || typeof row.adapter !== 'string') return undefined;
  return {
    adapter: row.adapter,
    name: row.name,
    status: row.status === 'online' ? 'online' : 'offline',
    ...(typeof row.phase === 'string' ? { phase: row.phase } : {}),
    ...(typeof row.transportLabel === 'string' ? { transport: row.transportLabel } : {}),
    ...(row.lastError && typeof row.lastError.message === 'string' ? { lastError: row.lastError.message } : {}),
  };
}

function mcpRow(row: Partial<ConsoleMcpServerRow>): RuntimeMcpServer | undefined {
  if (typeof row.name !== 'string') return undefined;
  const status = row.status ?? (row.connected ? 'connected' : 'disconnected');
  return {
    name: row.name,
    status,
    toolCount: typeof row.toolCount === 'number' ? row.toolCount : 0,
    ...(row.lastError && typeof row.lastError.message === 'string' ? { lastError: row.lastError.message } : {}),
  };
}

export async function readEndpoints(http: HostHttpConfig, timeoutMs = RUNTIME_READ_TIMEOUT_MS): Promise<RuntimeRead<RuntimeEndpoint>> {
  try {
    const data = await readRpc<{ endpoints?: readonly Partial<ConsoleEndpointSummary>[] }>(http, ENDPOINT_RPC.LIST, {}, timeoutMs);
    if (!Array.isArray(data.endpoints)) throw new Error('实例返回的不是账号列表');
    return { available: true, items: data.endpoints.flatMap(row => endpointRow(row) ?? []) };
  } catch (error) {
    return { available: false, error: message(error) };
  }
}

export async function readMcpServers(http: HostHttpConfig, timeoutMs = RUNTIME_READ_TIMEOUT_MS): Promise<RuntimeRead<RuntimeMcpServer>> {
  try {
    const result = await withDeadline(
      hostGet<{ items?: readonly Partial<ConsoleMcpServerRow>[] }>(http, '/introspection/mcp?page=1&pageSize=200', timeoutMs),
      timeoutMs + 500, 'MCP 状态',
    );
    if (!result.ok) throw new Error(failed(result));
    if (!Array.isArray(result.data?.items)) throw new Error('实例返回的不是 MCP 列表');
    return { available: true, items: result.data.items.flatMap(row => mcpRow(row) ?? []) };
  } catch (error) {
    return { available: false, error: message(error) };
  }
}

export async function readAttention(http: HostHttpConfig, timeoutMs = RUNTIME_READ_TIMEOUT_MS): Promise<RuntimeAttention> {
  try {
    const data = await readRpc<Partial<ConsoleAttentionList>>(http, ATTENTION_RPC.LIST, { locale: 'zh-CN' }, timeoutMs);
    if (!Array.isArray(data.items)) throw new Error('实例返回的不是待处理列表');
    const reasons = new Map((data.unavailableDetails ?? []).map(entry => [entry.source, entry.reason]));
    return {
      available: true,
      items: data.items.map((item: Partial<ConsoleAttentionItem>) => ({
        kind: String(item.kind ?? 'unknown'),
        severity: String(item.severity ?? 'warning'),
        title: String(item.title ?? item.kind ?? ''),
        detail: String(item.detail ?? ''),
        source: String(item.source ?? ''),
      })),
      unavailable: (data.unavailable ?? []).map(source => ({ source, ...(reasons.get(source) ? { reason: reasons.get(source)! } : {}) })),
    };
  } catch (error) {
    return { available: false, error: message(error) };
  }
}

/**
 * Reads all three through `root`'s running gateway. `http` replaces the connection (tests); a
 * connection that cannot be set up makes every read unavailable with the same reason.
 */
export async function readRuntimeState(
  root: string,
  options: { readonly http?: HostHttpConfig; readonly timeoutMs?: number } = {},
): Promise<RuntimeState> {
  const timeoutMs = options.timeoutMs ?? RUNTIME_READ_TIMEOUT_MS;
  let http = options.http;
  if (!http) {
    try {
      http = (await withDeadline(loadHostHttpConfig(root), timeoutMs, '连接网关')) ?? undefined;
      if (!http) throw new Error('未找到 zhin 配置文件');
    } catch (error) {
      const unavailable = { available: false as const, error: message(error) };
      return { endpoints: unavailable, mcp: unavailable, attention: unavailable };
    }
  }
  const [endpoints, mcp, attention] = await Promise.all([
    readEndpoints(http, timeoutMs), readMcpServers(http, timeoutMs), readAttention(http, timeoutMs),
  ]);
  return { endpoints, mcp, attention };
}

/** The same shape when the instance is not running: nothing to read. */
export function runtimeStateUnavailable(reason: string): RuntimeState {
  const unavailable = { available: false as const, error: reason };
  return { endpoints: unavailable, mcp: unavailable, attention: unavailable };
}

const PHASE_LABELS: Readonly<Record<string, string>> = {
  pending: '等待启动', starting: '启动中', awaiting_assist: '等待登录', online: '在线', offline: '离线',
  reconnecting: '重连中', retrying: '等待重试', failed: '启动失败', unconfigured: '未配置',
};

const MCP_LABELS: Readonly<Record<RuntimeMcpServer['status'], string>> = {
  connected: '已连接', failed: '连接失败', idle: '未连接（首次使用时连接）', not_loaded: '未加载', disconnected: '未连接',
};

/** `zhin status` lines for the runtime state (Chinese). */
export function renderRuntimeState(state: RuntimeState): string[] {
  const lines: string[] = [];
  if (!state.endpoints.available) lines.push(`适配器账号：无法读取（${state.endpoints.error}）`);
  else if (state.endpoints.items.length === 0) lines.push('适配器账号：无');
  else {
    const online = state.endpoints.items.filter(row => row.status === 'online').length;
    lines.push(`适配器账号：${online}/${state.endpoints.items.length} 在线`);
    for (const row of state.endpoints.items) {
      const label = row.status === 'online' ? '在线' : PHASE_LABELS[row.phase ?? ''] ?? '离线';
      lines.push(`  ${row.status === 'online' ? '✓' : '✗'} ${row.adapter}/${row.name}：${label}${row.lastError ? `（${row.lastError}）` : ''}`);
    }
  }
  if (!state.mcp.available) lines.push(`MCP 服务：无法读取（${state.mcp.error}）`);
  else if (state.mcp.items.length > 0) {
    lines.push('MCP 服务：');
    for (const row of state.mcp.items) {
      const ok = row.status === 'connected' || row.status === 'idle';
      const tools = row.status === 'connected' ? `，${row.toolCount} 个工具` : '';
      lines.push(`  ${ok ? '✓' : '✗'} ${row.name}：${MCP_LABELS[row.status]}${tools}${row.lastError ? `（${row.lastError}）` : ''}`);
    }
  }
  if (!state.attention.available) lines.push(`需要你处理：无法读取（${state.attention.error}）`);
  else {
    const count = state.attention.items.length;
    lines.push(count ? `需要你处理：${count} 项（zhin doctor 查看详情）` : '需要你处理：无');
    if (state.attention.unavailable.length) {
      lines.push(`  以下来源暂时无法读取，列表可能不完整：${state.attention.unavailable.map(entry => entry.source).join('、')}`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------- last-run failure journal

/** The instance's failure journal, relative to the project root (written by the instance). */
export const RUNTIME_FAILURES_FILE = '.zhin/runtime-failures.json';

export interface RecordedRuntimeFailure {
  readonly source: string;
  readonly subject: string;
  readonly code?: string;
  readonly category?: string;
  readonly message: string;
  /** Epoch ms of the latest observation. */
  readonly lastAt?: number;
  readonly count?: number;
}

/**
 * Entries of `.zhin/runtime-failures.json` (`{ version: 1, entries: [...] }`), newest first.
 * Undefined when the file does not exist; an unreadable file yields `{ error }`.
 */
export function readRuntimeFailureJournal(root: string): { readonly entries: readonly RecordedRuntimeFailure[] } | { readonly error: string } | undefined {
  const file = path.join(root, RUNTIME_FAILURES_FILE);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    return { error: message(error) };
  }
  try {
    const parsed = JSON.parse(text) as { entries?: unknown };
    if (!Array.isArray(parsed.entries)) return { error: `${RUNTIME_FAILURES_FILE} 的格式无法识别` };
    const entries = parsed.entries.flatMap((entry: Record<string, unknown>): RecordedRuntimeFailure[] => {
      if (!entry || typeof entry !== 'object' || typeof entry.subject !== 'string' || typeof entry.message !== 'string') return [];
      return [{
        source: typeof entry.source === 'string' ? entry.source : 'unknown',
        subject: entry.subject,
        message: entry.message.slice(0, 300),
        ...(typeof entry.code === 'string' ? { code: entry.code } : {}),
        ...(typeof entry.category === 'string' ? { category: entry.category } : {}),
        ...(typeof entry.lastAt === 'number' ? { lastAt: entry.lastAt } : {}),
        ...(typeof entry.count === 'number' ? { count: entry.count } : {}),
      }];
    });
    return { entries: entries.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0)) };
  } catch {
    return { error: `${RUNTIME_FAILURES_FILE} 不是有效的 JSON` };
  }
}

const SOURCE_LABELS: Readonly<Record<string, string>> = { account: '模型账号', model: '模型调用', endpoint: '适配器账号', mcp: 'MCP 服务' };

/** One line per recorded failure (Chinese). */
export function formatRecordedFailure(entry: RecordedRuntimeFailure): string {
  const notes = [
    entry.code,
    entry.count && entry.count > 1 ? `共 ${entry.count} 次` : undefined,
    entry.lastAt ? `最近 ${new Date(entry.lastAt).toISOString()}` : undefined,
  ].filter((note): note is string => note !== undefined);
  return `${SOURCE_LABELS[entry.source] ?? entry.source} ${entry.subject}：${entry.message}${notes.length ? `（${notes.join('，')}）` : ''}`;
}
