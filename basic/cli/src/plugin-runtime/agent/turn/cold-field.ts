/**
 * 冷场 → 会话临时 `mention_only`（ADR 0037 §1.3，第 1 期切片 C）。
 *
 * - 计数：只统计**群消息**（`scope=group`）。一条未点名的群消息真正进入旁听判定、且结果不是 `engage`
 *   （`declined` / `shadow` / `skipped`）时计 1；未启用旁听、空文本、被控制面或 session-gate 提前拦下的消息
 *   既不计数也不清零。
 * - 清零：任意一条点名（@Bot / 触发前缀）、旁听参与、Bot 主动发言（scene event 唤醒发出、模板欢迎、公告）。
 * - 命中 `coldField.threshold`：给该会话加控制面**临时覆盖** `mention_only`（`expiresAt`、`actor=policy`），
 *   写 `control_change` / `cold_field_mention_only_on`；到期自动撤销，写 `control_change` /
 *   `cold_field_mention_only_expired`。临时覆盖与运营者手动覆盖分存、只会更严、不进 revision（见 `AiControlPlane`）。
 * - 计数器与临时覆盖都只在进程内存：重启即清（回到运营者的手动状态）。
 * - 冷场是降噪而不是授权：任何一步出错只记日志、不拦消息。
 */
import { randomUUID } from 'node:crypto';
import {
  sceneKeyOf,
  type AiControlPlane,
  type AiSessionOps,
  type ControlTemporaryOverride,
  type DecisionEventLog,
} from '@zhin.js/agent';
import { formatCompact, getLogger } from '@zhin.js/logger';

const logger = getLogger('agent');

/** 进程内最多记住多少个群的计数（超出时丢最早的）。 */
export const MAX_COLD_FIELD_COUNTERS = 5_000;
/** 审计 `actor_id`：冷场策略。 */
export const COLD_FIELD_ACTOR_ID = 'cold_field';

export interface ColdFieldDeps {
  readonly sessionOps: () => AiSessionOps | undefined;
  readonly controlPlane: () => AiControlPlane | undefined;
  readonly decisionEvents?: () => DecisionEventLog | undefined;
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/** 群消息定位：`key` 与旁听 / `onSpoke` 同口径（`<platform>:<群号>`）。 */
export interface ColdFieldTarget {
  readonly platform: string;
  /** 平台原生群号（不带 `group:` 前缀）。 */
  readonly conversationId: string;
}

export function coldFieldKey(target: ColdFieldTarget): string {
  return `${target.platform}:${target.conversationId}`;
}

export class ColdFieldMonitor {
  readonly #counts = new Map<string, number>();
  readonly #timers = new Set<unknown>();
  #disposed = false;

  constructor(private readonly deps: ColdFieldDeps) {}

  /** 当前计数（测试 / 诊断用）。 */
  count(key: string): number {
    return this.#counts.get(key) ?? 0;
  }

  /** 点名、旁听参与、Bot 主动发言：清零。`key` 为 `<platform>:<群号>`。 */
  reset(key: string): void {
    this.#counts.delete(key);
  }

  /**
   * 一条未点名的群消息经过了旁听判定且没有参与：计 1；达到阈值时加临时 `mention_only`。
   * 返回本次加上的临时覆盖（没加时为 `undefined`）。
   */
  noteNotEngaged(target: ColdFieldTarget): ControlTemporaryOverride | undefined {
    if (this.#disposed || !target.platform || !target.conversationId) return undefined;
    const key = coldFieldKey(target);
    try {
      const sceneId = sceneKeyOf('group', target.conversationId);
      const config = this.deps.sessionOps()?.resolve(target.platform, sceneId).coldField;
      if (!config?.enabled) {
        this.#counts.delete(key);
        return undefined;
      }
      const next = (this.#counts.get(key) ?? 0) + 1;
      if (next < config.threshold) {
        this.#remember(key, next);
        return undefined;
      }
      this.#counts.delete(key);
      const plane = this.deps.controlPlane();
      const entry = plane?.addTemporaryMentionOnly({ platform: target.platform, sceneId, durationMs: config.durationMs, source: 'cold_field' });
      if (!entry) return undefined;
      this.#audit(entry, 'cold_field_mention_only_on', { threshold: config.threshold, count: next, durationMs: config.durationMs });
      logger.info(formatCompact({ op: 'cold_field_mention_only_on', conv: key, threshold: config.threshold, expiresAt: entry.expiresAt }));
      this.#schedule(config.durationMs);
      return entry;
    } catch (error) {
      logger.warn(formatCompact({ op: 'cold_field_failed', conv: key, error: error instanceof Error ? error.message : String(error) }));
      return undefined;
    }
  }

  /** 撤掉到期的临时覆盖并写 `cold_field_mention_only_expired`；判定本身不依赖这一步（控制面按 `expiresAt` 自行失效）。 */
  sweep(): ControlTemporaryOverride[] {
    let expired: ControlTemporaryOverride[] = [];
    try {
      expired = this.deps.controlPlane()?.expireTemporary() ?? [];
    } catch (error) {
      logger.warn(formatCompact({ op: 'cold_field_sweep_failed', error: error instanceof Error ? error.message : String(error) }));
      return [];
    }
    for (const entry of expired) {
      this.#audit(entry, 'cold_field_mention_only_expired', {});
      logger.info(formatCompact({ op: 'cold_field_mention_only_expired', conv: `${entry.platform}:${entry.sceneId}` }));
    }
    return expired;
  }

  dispose(): void {
    this.#disposed = true;
    const clear = this.deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    for (const handle of this.#timers) clear(handle);
    this.#timers.clear();
    this.#counts.clear();
  }

  #remember(key: string, value: number): void {
    this.#counts.delete(key);
    this.#counts.set(key, value);
    while (this.#counts.size > MAX_COLD_FIELD_COUNTERS) {
      const oldest = this.#counts.keys().next().value;
      if (oldest === undefined) break;
      this.#counts.delete(oldest);
    }
  }

  #schedule(ms: number): void {
    const set = this.deps.setTimer ?? ((run, delay) => {
      const handle = setTimeout(run, delay);
      (handle as { unref?: () => void }).unref?.();
      return handle;
    });
    const handle: unknown = set(() => {
      this.#timers.delete(handle);
      if (!this.#disposed) this.sweep();
    }, ms + 1);
    this.#timers.add(handle);
  }

  #audit(
    entry: ControlTemporaryOverride,
    reasonCode: 'cold_field_mention_only_on' | 'cold_field_mention_only_expired',
    extra: Record<string, unknown>,
  ): void {
    const log = this.deps.decisionEvents?.();
    if (!log) return;
    try {
      void log.record({
        turnId: randomUUID(),
        instanceId: '*',
        platform: entry.platform,
        sceneId: entry.sceneId,
        kind: 'control_change',
        outcome: 'allow',
        reasonCode,
        reasonDetail: `policy ${reasonCode === 'cold_field_mention_only_on' ? 'on' : 'off'}:${entry.switch}`,
        payload: { level: 'policy', source: entry.source, switch: entry.switch, since: entry.since, expiresAt: entry.expiresAt, ...extra },
        actor: 'policy',
        actorId: COLD_FIELD_ACTOR_ID,
      }).catch(() => undefined);
    } catch (error) {
      logger.warn(formatCompact({ op: 'decision_event_record_failed', kind: 'control_change', error: error instanceof Error ? error.message : String(error) }));
    }
  }
}
