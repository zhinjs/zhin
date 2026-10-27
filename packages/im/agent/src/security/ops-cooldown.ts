/**
 * 群管冷却（ADR 0037 §3，第 1 期切片 E / G4）。
 *
 * - 键：`platform + scene_id + 动作`，动作 = 工具本地名（{@link toolLocalName}，如 `kick_member`）；
 *   `scene_id` 与硬闸审计 / 会话画像同口径（`<scope>:<sceneId>`）。不同动作、不同会话互不影响。
 * - 时长：`ops.cooldownMs`（默认 `60000`），由宿主从会话运营配置读（实例默认 + 会话覆盖，见 `session-ops.ts`）；
 *   `0` 表示该会话不冷却。读配置出错时回落默认值，不会因此放开。
 * - 计时从**审批卡创建**开始（{@link OpsCooldown.acquire} 在硬闸入队之前原子地「判定 + 开始计时」），
 *   不论之后批准、驳回还是超时；被驳回的动作同样冷却，避免模型换参数刷卡。
 * - 命中冷却由硬闸 fail closed：不生成新审批卡，给模型「冷却中」与剩余毫秒。
 * - 只在进程内存（v1）：重启后冷却清空。冷却是防刷卡的节流，不是授权——即使冷却被重启清空，
 *   危险工具仍要过硬闸的人工审批。条目数有上限，过期条目在写入时顺手清理。
 */
import { DEFAULT_OPS_COOLDOWN_MS, MAX_OPS_COOLDOWN_MS } from '../session-ops.js';

/** 进程内最多记住的冷却条目数；超出时先清过期条目，仍超出则丢最早的。 */
export const MAX_OPS_COOLDOWN_ENTRIES = 10_000;

export interface OpsCooldownKey {
  readonly platform: string;
  /** `<scope>:<sceneId>`。 */
  readonly sceneId: string;
  /** 工具本地名。 */
  readonly action: string;
}

export type OpsCooldownDecision =
  | Readonly<{ status: 'passed'; cooldownMs: number }>
  | Readonly<{ status: 'hit'; cooldownMs: number; remainingMs: number; startedAt: number }>;

/** 硬闸只用到这一个方法；宿主可换成持久化实现。 */
export interface OpsCooldownView {
  /**
   * 判定并（放行时）立即开始计时：未在冷却中返回 `passed` 并记下本次时间；在冷却中返回 `hit` 与剩余毫秒，不改计时。
   * 判定与计时是同一步，避免两个并发回合同时通过。
   */
  acquire(key: OpsCooldownKey): OpsCooldownDecision;
}

export interface OpsCooldownOptions {
  readonly now?: () => number;
  /** 该会话的冷却时长（毫秒）；缺省或出错时用 {@link DEFAULT_OPS_COOLDOWN_MS}。 */
  readonly resolveCooldownMs?: (platform: string, sceneId: string) => number;
  readonly maxEntries?: number;
}

function keyOf(key: OpsCooldownKey): string {
  return `${key.platform}\u0000${key.sceneId}\u0000${key.action}`;
}

/** 进程内冷却表（每个 Agent 进程一份，宿主持有）。 */
export class OpsCooldown implements OpsCooldownView {
  readonly #now: () => number;
  readonly #resolve: ((platform: string, sceneId: string) => number) | undefined;
  readonly #maxEntries: number;
  /** key → { startedAt, until }。 */
  readonly #entries = new Map<string, { startedAt: number; until: number }>();

  constructor(options: OpsCooldownOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#resolve = options.resolveCooldownMs;
    this.#maxEntries = Math.max(1, Math.trunc(options.maxEntries ?? MAX_OPS_COOLDOWN_ENTRIES));
  }

  /** 该会话生效的冷却时长；非法值回落默认。 */
  cooldownMs(platform: string, sceneId: string): number {
    let value: unknown = DEFAULT_OPS_COOLDOWN_MS;
    try {
      if (this.#resolve) value = this.#resolve(platform, sceneId);
    } catch {
      value = DEFAULT_OPS_COOLDOWN_MS;
    }
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? Math.min(Math.trunc(value), MAX_OPS_COOLDOWN_MS)
      : DEFAULT_OPS_COOLDOWN_MS;
  }

  acquire(key: OpsCooldownKey): OpsCooldownDecision {
    const now = this.#now();
    const cooldownMs = this.cooldownMs(key.platform, key.sceneId);
    const id = keyOf(key);
    const current = this.#entries.get(id);
    // 计时按「卡片创建时的时长」记下 until；运营者调短配置后，已开始的冷却按新时长重新比较。
    if (current) {
      const until = Math.min(current.until, current.startedAt + cooldownMs);
      if (until > now) {
        return Object.freeze({ status: 'hit', cooldownMs, remainingMs: until - now, startedAt: current.startedAt });
      }
      this.#entries.delete(id);
    }
    if (cooldownMs > 0) {
      this.#entries.set(id, { startedAt: now, until: now + cooldownMs });
      this.#prune(now);
    }
    return Object.freeze({ status: 'passed', cooldownMs });
  }

  /** 剩余冷却毫秒（只读，不改计时）；不在冷却中为 0。 */
  remainingMs(key: OpsCooldownKey): number {
    const current = this.#entries.get(keyOf(key));
    if (!current) return 0;
    const until = Math.min(current.until, current.startedAt + this.cooldownMs(key.platform, key.sceneId));
    return Math.max(0, until - this.#now());
  }

  get size(): number {
    return this.#entries.size;
  }

  clear(): void {
    this.#entries.clear();
  }

  #prune(now: number): void {
    if (this.#entries.size <= this.#maxEntries) return;
    for (const [id, entry] of this.#entries) if (entry.until <= now) this.#entries.delete(id);
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next();
      if (oldest.done) break;
      this.#entries.delete(oldest.value);
    }
  }
}

/** 审计 / 拒绝说明里的「目标」：取工具参数里常见的成员 / 目标字段（仅标量）。 */
const TARGET_FIELDS = ['target', 'targetId', 'target_id', 'userId', 'user_id', 'memberId', 'member_id', 'member', 'uid', 'qq'] as const;

export function opsCooldownTarget(input: Readonly<Record<string, unknown>>): string | undefined {
  for (const field of TARGET_FIELDS) {
    const value = input[field];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 128);
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}
