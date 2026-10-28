// `@zhin.js/agent` 是可选 peer：这里只做类型导入，运行时不依赖它。
import type {
  DecisionEventKind,
  DecisionEventQuery,
  DecisionEventReader,
  DecisionEventRecord,
  DecisionOutcome,
} from '@zhin.js/agent';
import { PluginConsoleRpcError, type PluginConsoleRpcInput, type PluginConsoleRpcJson, type PluginConsoleRpcStatus } from '@zhin.js/plugin-runtime';
import { getLogger, formatCompact } from '@zhin.js/logger';

/**
 * Console 回放（ADR 0036 切片 C）：只读查询 `ai_decision_events`。
 *
 * - `plugin.root.decisions`：倒序列表（新 → 旧），按平台 / 会话 / kind / outcome / reasonCode / 时间过滤，`nextBefore` 翻页。
 *   `reasonCode` 用于复用 kind 的场景（如 ADR 0037 切片 C 冷场复用 `control_change`，按 `cold_field_mention_only_*` 区分）。
 * - `plugin.root.decision-turn`：按 `turn_id` 展开一个回合，正序时间线。
 * - `plugin.root.decisions-export`：时间窗内（可叠加同样的过滤）导出 JSON，字段与表结构一致（snake_case），
 *   按 `nextSince` 分页（单次返回受 Console RPC 256 KiB 上限约束）。
 *
 * 三者都要 `decisions:read`；入口在「机器人状态」页。不含控制面（切片 D）与硬闸（切片 E）。
 * 返回的 payload 已在写入时脱敏（无密钥 / Cookie / token / 完整提示词）。
 */

export const DECISIONS_READ_PERMISSION = 'decisions:read';
/** 导出时间窗上限：与默认保留期同量级，避免一次拉全表。 */
export const DECISION_EXPORT_MAX_WINDOW_MS = 31 * 86_400_000;

/** 导出 / 时间线每页最多行数。 */
export const DECISION_EXPORT_PAGE_ROWS = 1_000;
/** 每页 JSON 字符预算，低于 Console RPC 的 256 KiB 返回上限，留出外层字段余量。 */
export const DECISION_PAGE_BUDGET_CHARS = 200_000;
const QUERY_MAX_LIMIT = DECISION_EXPORT_PAGE_ROWS;
const LIST_DEFAULT_LIMIT = 50;
const LIST_MAX_LIMIT = 200;

const logger = getLogger('console');
// 镜像 ADR 0036 §1 的枚举（类型上与 agent 包对齐，新增值时这里编译即报错）。
const KIND_LIST = [
  'inbound_wake', 'speak_gate', 'control_gate', 'ambient_decision', 'model_skip', 'model_run',
  'tool_call', 'tool_hard_gate', 'tool_approval', 'outbound', 'config_change', 'control_change',
  'member_lifecycle', 'announcement', 'ops_cooldown', 'schedule', 'group_rule', 'rule_enforcement',
] as const satisfies readonly DecisionEventKind[];
const OUTCOME_LIST = ['allow', 'deny', 'skip', 'defer', 'error'] as const satisfies readonly DecisionOutcome[];
type MissingKind = Exclude<DecisionEventKind, typeof KIND_LIST[number]>;
type MissingOutcome = Exclude<DecisionOutcome, typeof OUTCOME_LIST[number]>;
const _exhaustive: [MissingKind, MissingOutcome] extends [never, never] ? true : never = true;
void _exhaustive;
const KINDS: ReadonlySet<string> = new Set(KIND_LIST);
const OUTCOMES: ReadonlySet<string> = new Set(OUTCOME_LIST);
const MAX_TEXT = 256;
/** `reason_code` 形状（码表在 agent 包，这里只校验形状；拼错时返回空页而不是报错）。 */
const REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;

export type DecisionEventsSource = () => DecisionEventReader | undefined;

/** 导出 / 返回给 Console 的行：字段与 `ai_decision_events` 表同名（snake_case），payload 为对象。 */
export interface DecisionEventExportRow {
  id: string;
  ts: number;
  turn_id: string;
  instance_id: string;
  platform: string;
  scene_id: string;
  user_id: string | null;
  kind: string;
  outcome: string;
  reason_code: string;
  reason_detail: string | null;
  payload: Record<string, unknown>;
  actor: string;
  actor_id: string | null;
}

export function decisionEventExportRow(record: DecisionEventRecord): DecisionEventExportRow {
  return {
    id: record.id,
    ts: record.ts,
    turn_id: record.turnId,
    instance_id: record.instanceId,
    platform: record.platform,
    scene_id: record.sceneId,
    user_id: record.userId,
    kind: record.kind,
    outcome: record.outcome,
    reason_code: record.reasonCode,
    reason_detail: record.reasonDetail,
    payload: record.payload,
    actor: record.actor,
    actor_id: record.actorId,
  };
}

function invalid(message: string): never {
  throw new PluginConsoleRpcError('invalid_input', message);
}

function optionalTimestamp(input: PluginConsoleRpcInput, key: string): number | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid(`${key} 必须是毫秒时间戳`);
  return Math.trunc(value);
}

function optionalText(input: PluginConsoleRpcInput, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > MAX_TEXT) invalid(`${key} 必须是不超过 ${MAX_TEXT} 字符的字符串`);
  return value;
}

function optionalLimit(input: PluginConsoleRpcInput, fallback: number): number {
  const value = input.limit;
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalid('limit 必须是正整数');
  return Math.min(QUERY_MAX_LIMIT, value);
}

/** 解析共用过滤条件；kind / outcome 只认枚举，拼写错误直接报错而不是返回空。 */
export function parseDecisionFilter(input: PluginConsoleRpcInput): Omit<DecisionEventQuery, 'limit'> {
  const kind = optionalText(input, 'kind');
  if (kind && !KINDS.has(kind)) invalid(`未知 kind：${kind}`);
  const outcome = optionalText(input, 'outcome');
  if (outcome && !OUTCOMES.has(outcome)) invalid(`未知 outcome：${outcome}`);
  const reasonCode = optionalText(input, 'reasonCode');
  if (reasonCode && !REASON_CODE_PATTERN.test(reasonCode)) invalid(`reasonCode 形如 cold_field_mention_only_on：${reasonCode}`);
  const since = optionalTimestamp(input, 'since');
  const before = optionalTimestamp(input, 'before');
  if (since !== undefined && before !== undefined && since >= before) invalid('since 必须早于 before');
  const platform = optionalText(input, 'platform');
  const sceneId = optionalText(input, 'sceneId');
  return {
    ...(since !== undefined ? { since } : {}),
    ...(before !== undefined ? { before } : {}),
    ...(platform ? { platform } : {}),
    ...(sceneId ? { sceneId } : {}),
    ...(kind ? { kind } : {}),
    ...(outcome ? { outcome } : {}),
    ...(reasonCode ? { reasonCode } : {}),
  };
}

function toJson(rows: readonly DecisionEventRecord[]): DecisionEventExportRow[] {
  return rows.map((record) => decisionEventExportRow(record));
}

/**
 * 按字节预算截一页（Console RPC 单次返回上限 256 KiB），且只在 `ts` 变化处切：
 * 同一毫秒的行要么整组在本页，要么整组留给下一页，这样用 `ts` 当游标不会漏行也不会重复。
 * `fetched` 可能比本页多（多取一行用来判断还有没有）；返回 `cut` = 本页行数，`more` = 是否还有。
 */
export function cutPage(fetched: readonly DecisionEventExportRow[], maxRows: number, budget: number = DECISION_PAGE_BUDGET_CHARS): { rows: DecisionEventExportRow[]; more: boolean } {
  let cut = 0;
  let used = 0;
  while (cut < fetched.length && cut < maxRows) {
    const size = JSON.stringify(fetched[cut]).length + 1;
    if (cut > 0 && used + size > budget) break;
    used += size;
    cut += 1;
  }
  if (cut < fetched.length) {
    const boundary = fetched[cut]!.ts;
    let back = cut;
    while (back > 0 && fetched[back - 1]!.ts === boundary) back -= 1;
    if (back > 0) cut = back;
    else while (cut < fetched.length && fetched[cut]!.ts === boundary) cut += 1; // 整页同一毫秒：整组带上
  }
  return { rows: fetched.slice(0, cut), more: cut < fetched.length };
}

async function read<T>(source: DecisionEventsSource, op: string, run: (reader: DecisionEventReader) => Promise<T>): Promise<{ reader: DecisionEventReader; value: T }> {
  const reader = source();
  if (!reader) throw new PluginConsoleRpcError('unavailable', '机器人还没启动 AI，暂时没有决策记录');
  try {
    return { reader, value: await run(reader) };
  } catch (error) {
    if (error instanceof PluginConsoleRpcError) throw error;
    logger.warn(formatCompact({ op, status: 'failed', error: error instanceof Error ? error.message : String(error) }));
    throw new PluginConsoleRpcError('unavailable', '暂时读不到决策记录，请稍后再试');
  }
}

/** 列表：新 → 旧。还有更多时 `nextBefore` 非空，原样传回 `before` 翻下一页。 */
export async function listDecisionEvents(source: DecisionEventsSource, input: PluginConsoleRpcInput): Promise<PluginConsoleRpcJson> {
  const filter = parseDecisionFilter(input);
  const limit = Math.min(optionalLimit(input, LIST_DEFAULT_LIMIT), LIST_MAX_LIMIT);
  const { reader, value } = await read(source, 'decision_replay_list', (r) => r.query({ ...filter, order: 'desc', limit: limit + 1 }));
  const page = cutPage(toJson(value), limit);
  return {
    persistent: reader.persistent,
    items: page.rows,
    nextBefore: page.more && page.rows.length ? page.rows.at(-1)!.ts : null,
  } as unknown as PluginConsoleRpcJson;
}

/** 时间线：一个 `turn_id` 的全部事件，旧 → 新；超出单次返回上限时 `truncated: true`。 */
export async function decisionTurnTimeline(source: DecisionEventsSource, input: PluginConsoleRpcInput): Promise<PluginConsoleRpcJson> {
  const turnId = optionalText(input, 'turnId');
  if (!turnId) invalid('需要 turnId');
  const { reader, value } = await read(source, 'decision_replay_turn', (r) => r.turn(turnId, DECISION_EXPORT_PAGE_ROWS + 1));
  if (!value.length) throw new PluginConsoleRpcError('not_found', '没有找到这个回合的决策记录（可能已过保留期）');
  const page = cutPage(toJson(value), DECISION_EXPORT_PAGE_ROWS);
  return {
    persistent: reader.persistent,
    turnId,
    startedAt: value[0]!.ts,
    endedAt: page.rows.at(-1)!.ts,
    truncated: page.more,
    events: page.rows,
  } as unknown as PluginConsoleRpcJson;
}

/**
 * 导出：必须给时间窗（`since` + `until`，含两端），可叠加同样的过滤；按时间正序分页。
 * `nextSince` 非空时原样传回 `since` 取下一页，直到为 null；把各页 `events` 依次拼起来就是完整导出。
 */
export async function exportDecisionEvents(
  source: DecisionEventsSource,
  input: PluginConsoleRpcInput,
  now: () => number = Date.now,
): Promise<PluginConsoleRpcJson> {
  const since = optionalTimestamp(input, 'since');
  const until = optionalTimestamp(input, 'until');
  if (since === undefined || until === undefined) invalid('导出需要时间范围 since / until');
  if (since > until) invalid('since 必须不晚于 until');
  if (until - since > DECISION_EXPORT_MAX_WINDOW_MS) invalid('一次最多导出 31 天');
  const { since: _since, before: _before, ...rest } = parseDecisionFilter({ ...input, since: null, before: null });
  const { reader, value } = await read(source, 'decision_replay_export', (r) =>
    r.query({ ...rest, since, before: until + 1, order: 'asc', limit: DECISION_EXPORT_PAGE_ROWS + 1 }));
  const page = cutPage(toJson(value), DECISION_EXPORT_PAGE_ROWS);
  const next = page.more ? value[page.rows.length]!.ts : null;
  return {
    table: 'ai_decision_events',
    exportedAt: now(),
    persistent: reader.persistent,
    window: { since, until },
    filters: { ...rest },
    count: page.rows.length,
    nextSince: next,
    events: page.rows,
  } as unknown as PluginConsoleRpcJson;
}

/** 供 `definePluginConsoleRpc({ queries })` 合并的三个只读查询。 */
export function decisionReplayQueries(source: DecisionEventsSource, now: () => number = Date.now): Record<string, PluginConsoleRpcStatus> {
  const requiredPermissions = [DECISIONS_READ_PERMISSION];
  return {
    decisions: { requiredPermissions, handler: (input) => listDecisionEvents(source, input) },
    'decision-turn': { requiredPermissions, handler: (input) => decisionTurnTimeline(source, input) },
    'decisions-export': { requiredPermissions, handler: (input) => exportDecisionEvents(source, input, now) },
  };
}
