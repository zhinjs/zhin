/**
 * 决策审计写入（ADR 0036 切片 B）。
 *
 * - append-only：只 `create`，不改不删（清理任务不在本切片）。
 * - **审计不是门禁**：`record` 永不抛错、永不让调用方等待失败；构造校验失败或写库失败只记 warn。
 * - 未接数据库时只保留进程内最近若干条（诊断 / 测试用），不落盘。
 */
import { getLogger, formatCompact } from '@zhin.js/logger';
import {
  createDecisionEvent,
  decisionEventToRow,
  type DecisionEventInput,
  type DecisionEventRecord,
} from './decision-events.js';

const logger = getLogger('agent');

/** 进程内保留的最近记录条数。 */
export const DECISION_EVENT_RECENT_LIMIT = 200;

interface DecisionEventModel {
  create(row: Record<string, unknown>): Promise<unknown>;
}

export class DecisionEventLog {
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

  /** 等待已发出的写入落定（测试 / 关停用）。 */
  async idle(): Promise<void> {
    while (this.#pending.size > 0) await Promise.all([...this.#pending]);
  }
}
