/**
 * 决策审计写入（ADR 0036 切片 B）。
 *
 * - append-only：只 `create`，不改；唯一的删除是保留期清理 {@link DecisionEventLog.prune}（切片 C）。
 * - **审计不是门禁**：`record` 永不抛错、永不让调用方等待失败；构造校验失败或写库失败只记 warn。
 * - 未接数据库时只保留进程内最近若干条（诊断 / 测试用），不落盘。
 * - 读取（切片 C，Console 回放）：{@link DecisionEventLog.query} 倒序列表、{@link DecisionEventLog.turn} 按回合时间线。
 */
import { getLogger, formatCompact } from '@zhin.js/logger';
import {
  createDecisionEvent,
  decisionEventFromRow,
  decisionEventToRow,
  DEFAULT_DECISION_AUDIT_RETENTION_DAYS,
  type DecisionEventInput,
  type DecisionEventRecord,
} from './decision-events.js';

const logger = getLogger('agent');

/** 进程内保留的最近记录条数。 */
export const DECISION_EVENT_RECENT_LIMIT = 200;

/** 一次读取最多返回的条数（列表 / 导出 / 时间线共用硬上限；Console 自己的分页 / 导出上限更小）。 */
export const DECISION_EVENT_QUERY_MAX_LIMIT = 10_000;
/** 列表默认条数。 */
export const DECISION_EVENT_QUERY_DEFAULT_LIMIT = 100;
const DAY_MS = 86_400_000;

/** 查询构造器（`@zhin.js/database` 的 select / delete 链）；只用到这几个方法。 */
interface DecisionEventSelect extends PromiseLike<Record<string, unknown>[]> {
  where(condition: Record<string, unknown>): DecisionEventSelect;
  orderBy(field: string, direction?: 'ASC' | 'DESC'): DecisionEventSelect;
  limit(count: number): DecisionEventSelect;
}
interface DecisionEventDelete extends PromiseLike<unknown> {
  where(condition: Record<string, unknown>): PromiseLike<unknown>;
}

interface DecisionEventModel {
  create(row: Record<string, unknown>): Promise<unknown>;
  select?(): DecisionEventSelect;
  delete?(): DecisionEventDelete;
}

/** Console 回放的筛选条件；全部可选，`since` 含、`before` 不含。 */
export interface DecisionEventQuery {
  readonly since?: number;
  readonly before?: number;
  readonly platform?: string;
  readonly sceneId?: string;
  readonly turnId?: string;
  readonly kind?: string;
  readonly outcome?: string;
  /** 默认 `desc`（新 → 旧）；导出按 `asc` 翻页。 */
  readonly order?: 'asc' | 'desc';
  /** 默认 {@link DECISION_EVENT_QUERY_DEFAULT_LIMIT}，上限 {@link DECISION_EVENT_QUERY_MAX_LIMIT}。 */
  readonly limit?: number;
}

/** 只读视图：Console 回放只需要这些。 */
export interface DecisionEventReader {
  readonly persistent: boolean;
  query(filter?: DecisionEventQuery): Promise<DecisionEventRecord[]>;
  turn(turnId: string, limit?: number): Promise<DecisionEventRecord[]>;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DECISION_EVENT_QUERY_DEFAULT_LIMIT;
  return Math.min(DECISION_EVENT_QUERY_MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function whereOf(filter: DecisionEventQuery): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  const ts: Record<string, number> = {};
  if (filter.since !== undefined) ts.$gte = filter.since;
  if (filter.before !== undefined) ts.$lt = filter.before;
  if (Object.keys(ts).length) where.ts = ts;
  if (filter.platform) where.platform = filter.platform;
  if (filter.sceneId) where.scene_id = filter.sceneId;
  if (filter.turnId) where.turn_id = filter.turnId;
  if (filter.kind) where.kind = filter.kind;
  if (filter.outcome) where.outcome = filter.outcome;
  return where;
}

function matches(record: DecisionEventRecord, filter: DecisionEventQuery): boolean {
  return (filter.since === undefined || record.ts >= filter.since)
    && (filter.before === undefined || record.ts < filter.before)
    && (!filter.platform || record.platform === filter.platform)
    && (!filter.sceneId || record.sceneId === filter.sceneId)
    && (!filter.turnId || record.turnId === filter.turnId)
    && (!filter.kind || record.kind === filter.kind)
    && (!filter.outcome || record.outcome === filter.outcome);
}

export class DecisionEventLog implements DecisionEventReader {
  #model: DecisionEventModel | undefined;
  readonly #recent: DecisionEventRecord[] = [];
  readonly #pending = new Set<Promise<unknown>>();

  constructor(private readonly now: () => number = Date.now) {}

  /** 接上 `ai_decision_events` 模型后，新记录写库。 */
  upgradeToDatabase(model: DecisionEventModel): void {
    this.#model = model;
  }

  get persistent(): boolean {
    return this.#model !== undefined;
  }

  /**
   * 追加一条审计。永不 reject：返回写入的记录，校验或写库失败时返回 null（只记日志）。
   * 调用方通常 `void` 掉，不阻断回合。
   */
  record(input: DecisionEventInput): Promise<DecisionEventRecord | null> {
    let record: DecisionEventRecord;
    try {
      record = createDecisionEvent(input, this.now());
    } catch (error) {
      logger.warn(formatCompact({ op: 'decision_event_invalid', kind: input?.kind, error: error instanceof Error ? error.message : String(error) }));
      return Promise.resolve(null);
    }
    this.#recent.push(record);
    if (this.#recent.length > DECISION_EVENT_RECENT_LIMIT) this.#recent.splice(0, this.#recent.length - DECISION_EVENT_RECENT_LIMIT);
    const model = this.#model;
    if (!model) return Promise.resolve(record);
    const write = Promise.resolve()
      .then(() => model.create(decisionEventToRow(record)))
      .then(() => record, (error: unknown) => {
        logger.warn(formatCompact({ op: 'decision_event_write_failed', kind: record.kind, error: error instanceof Error ? error.message : String(error) }));
        return null;
      });
    this.#pending.add(write);
    void write.finally(() => this.#pending.delete(write));
    return write;
  }

  /** 进程内最近记录（旧 → 新）。 */
  recent(): readonly DecisionEventRecord[] {
    return [...this.#recent];
  }

  /**
   * 列表，默认倒序（新 → 旧），`order: 'asc'` 时正序。接库后读 `ai_decision_events`；未接库时读进程内最近记录。
   * 读失败会抛错，由调用方（Console）转成「暂时读不到」。
   */
  async query(filter: DecisionEventQuery = {}): Promise<DecisionEventRecord[]> {
    const limit = clampLimit(filter.limit);
    const model = this.#model;
    const asc = filter.order === 'asc';
    if (!model?.select) {
      return this.#recent.filter((record) => matches(record, filter)).sort((a, b) => (asc ? a.ts - b.ts : b.ts - a.ts)).slice(0, limit);
    }
    const where = whereOf(filter);
    let select = model.select();
    if (Object.keys(where).length) select = select.where(where);
    const rows = await select.orderBy('ts', asc ? 'ASC' : 'DESC').limit(limit);
    return rows.map((row) => decisionEventFromRow(row));
  }

  /** 一个回合内的全部事件，按时间正序（旧 → 新），用于时间线下钻。 */
  async turn(turnId: string, limit: number = DECISION_EVENT_QUERY_MAX_LIMIT): Promise<DecisionEventRecord[]> {
    if (!turnId) return [];
    const max = clampLimit(limit);
    const model = this.#model;
    if (!model?.select) return this.#recent.filter((record) => record.turnId === turnId).sort((a, b) => a.ts - b.ts).slice(0, max);
    const rows = await model.select().where({ turn_id: turnId }).orderBy('ts', 'ASC').limit(max);
    return rows.map((row) => decisionEventFromRow(row));
  }

  /**
   * 保留期清理（`ai.audit.retentionDays`，默认 14 天）：删除 `ts` 早于 now - retentionDays 天的行。
   * 未接库时只裁内存。失败只记日志，返回 false。
   */
  async prune(retentionDays: number = DEFAULT_DECISION_AUDIT_RETENTION_DAYS): Promise<boolean> {
    if (!Number.isSafeInteger(retentionDays) || retentionDays <= 0) {
      throw new TypeError('ai.audit.retentionDays must be a positive integer');
    }
    const cutoff = this.now() - retentionDays * DAY_MS;
    const keep = this.#recent.filter((record) => record.ts >= cutoff);
    this.#recent.splice(0, this.#recent.length, ...keep);
    const model = this.#model;
    if (!model?.delete) return true;
    try {
      await model.delete().where({ ts: { $lt: cutoff } });
      return true;
    } catch (error) {
      logger.warn(formatCompact({ op: 'decision_event_prune_failed', error: error instanceof Error ? error.message : String(error) }));
      return false;
    }
  }

  /** 等待已发出的写入落定（测试 / 关停用）。 */
  async idle(): Promise<void> {
    while (this.#pending.size > 0) await Promise.all([...this.#pending]);
  }
}
