/**
 * Runtime state for the terminal (#1250 `doctor-blind-to-runtime-health`): adapter accounts
 * (`endpoint.list`), MCP servers (`GET /introspection/mcp`) and the attention inbox
 * (`attention.list`), read through this project's gateway over its local control socket (as the
 * local owner). Every read has a deadline; a read that fails or times out is reported as
 * 「无法读取」 and never fails `zhin status` / `zhin doctor` on its own.
 *
 * Without a running gateway, `.zhin/runtime-failures.json` tells what failed during the last run.
 * Its only writer is the Zhin instance's `RuntimeFailureJournal` (zhin.js,
 * `packages/im/zhin/src/instance/console/runtime-failures.ts`, added by #1270 batch 14); until a
 * release with that writer runs, the file does not exist and nothing is shown.
 */
import { formatDateTime } from '@zhin.js/plugin-runtime';
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
  /**
   * Agents that bind the server in `ai.agents.<name>.mcpServers` (#1250 第 41 批); empty: no Agent
   * can use its tools. Absent on instances that do not report it.
   */
  readonly boundAgents?: readonly string[];
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
    ...(Array.isArray(row.boundAgents)
      ? { boundAgents: row.boundAgents.filter((name): name is string => typeof name === 'string') }
      : {}),
  };
}

/** Connected, but no Agent binds it: its tools reach no turn (#1250 第 41 批). */
export function isUnboundMcpServer(row: RuntimeMcpServer): boolean {
  return row.status === 'connected' && row.boundAgents !== undefined && row.boundAgents.length === 0;
}

/** The hint `zhin status` shows for {@link isUnboundMcpServer} rows. */
export const MCP_UNBOUND_HINT = '已连接但没有 Agent 能用，在 ai.agents.<name>.mcpServers 里绑定';

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
  connected: '已连接', failed: '连接失败', idle: '待连接', not_loaded: '未加载', disconnected: '未连接',
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
      const unbound = isUnboundMcpServer(row);
      const ok = !unbound && (row.status === 'connected' || row.status === 'idle');
      const tools = row.status === 'connected' ? `，${row.toolCount} 个工具` : '';
      const bound = row.status === 'connected' && row.boundAgents?.length ? `，绑定：${row.boundAgents.join('、')}` : '';
      const note = unbound ? `（${MCP_UNBOUND_HINT}）` : row.lastError ? `（${row.lastError}）` : '';
      lines.push(`  ${ok ? '✓' : unbound ? '!' : '✗'} ${row.name}：${MCP_LABELS[row.status]}${tools}${bound}${note}`);
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

/**
 * Failure journal path relative to the project root. Written only by the instance's
 * `RuntimeFailureJournal` (zhin.js `src/instance/console/runtime-failures.ts`, #1270 batch 14),
 * atomically (temp file + rename) and removed when no failure is left. Same value as
 * `RUNTIME_FAILURES_FILE` of `@zhin.js/console-protocol` from that batch on.
 */
export const RUNTIME_FAILURES_FILE = '.zhin/runtime-failures.json';

/** `source` values the writer uses (`ConsoleRuntimeFailureSource`). */
const FAILURE_SOURCES: ReadonlySet<string> = new Set(['account', 'endpoint', 'mcp', 'model']);

export interface RecordedRuntimeFailure {
  readonly source: string;
  readonly subject: string;
  readonly code: string;
  readonly category: string;
  readonly message: string;
  /** Epoch ms of the first and the latest observation since the subject last succeeded. */
  readonly firstAt: number;
  readonly lastAt: number;
  readonly count: number;
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * One entry, validated like the writer's own reader (`parseEntry` in runtime-failures.ts): `source`
 * one of the known sources, non-empty `subject` (≤ 512), `code`, `category`, `firstAt`, `lastAt`
 * and a positive `count`; `message` falls back to `code`. Malformed entries are dropped.
 */
function parseRecordedFailure(value: unknown): RecordedRuntimeFailure | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.source !== 'string' || !FAILURE_SOURCES.has(raw.source)) return undefined;
  if (typeof raw.subject !== 'string' || !raw.subject || raw.subject.length > 512) return undefined;
  if (typeof raw.code !== 'string' || !raw.code || typeof raw.category !== 'string' || !raw.category) return undefined;
  if (!isCount(raw.firstAt) || !isCount(raw.lastAt) || !isCount(raw.count) || raw.count === 0) return undefined;
  return {
    source: raw.source, subject: raw.subject, code: raw.code, category: raw.category,
    message: (typeof raw.message === 'string' && raw.message ? raw.message : raw.code).slice(0, 300),
    firstAt: raw.firstAt, lastAt: raw.lastAt, count: raw.count,
  };
}

/**
 * Entries of `.zhin/runtime-failures.json` (`{ version: 1, entries: [...] }`), newest first.
 * Undefined when the file does not exist (no failure left, or no instance with the writer has run
 * yet); a file that cannot be read or parsed yields `{ error }`.
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
  let parsed: { version?: unknown; entries?: unknown };
  try {
    parsed = JSON.parse(text) as { version?: unknown; entries?: unknown };
  } catch {
    return { error: `${RUNTIME_FAILURES_FILE} 不是有效的 JSON` };
  }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    return { error: `${RUNTIME_FAILURES_FILE} 的格式无法识别（应为 version 1）` };
  }
  const entries = parsed.entries.flatMap(entry => parseRecordedFailure(entry) ?? []);
  return { entries: entries.sort((a, b) => b.lastAt - a.lastAt) };
}

const SOURCE_LABELS: Readonly<Record<string, string>> = { account: '模型账号', model: '模型调用', endpoint: '适配器账号', mcp: 'MCP 服务' };

/** One line per recorded failure (Chinese). */
export function formatRecordedFailure(entry: RecordedRuntimeFailure): string {
  const notes = [
    entry.code,
    entry.count > 1 ? `共 ${entry.count} 次` : undefined,
    entry.lastAt ? `最近 ${formatDateTime(entry.lastAt)}` : undefined,
  ].filter((note): note is string => note !== undefined);
  return `${SOURCE_LABELS[entry.source] ?? entry.source} ${entry.subject}：${entry.message}${notes.length ? `（${notes.join('，')}）` : ''}`;
}
