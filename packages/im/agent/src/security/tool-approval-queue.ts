/**
 * 危险工具审批队列（ADR 0036 §3，切片 E）。
 *
 * 硬闸拦下的每一次危险调用都在这里留一张「审批卡片」：交互回合里它和 IM 审批提示同时等待，
 * 谁先给出结论算谁；无人值守回合直接 fail closed，卡片留给运营者在 Console 处理，
 * 批准后由**下一次同参数调用**一次性消费。超时默认拒绝。
 *
 * 只在进程内存中保存有限条目；参数先经 {@link redactDecisionPayload} 脱敏，不存密钥与提示词。
 */
import { redactDecisionPayload, type DecisionPayload } from '../decision-events.js';
import type { DangerousToolCategory } from './tool-hard-gate.js';

export type ToolApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'consumed';
export type ToolApprovalSettlement = 'approved' | 'denied' | 'expired';

export interface ToolApprovalEntry {
  readonly id: string;
  readonly toolName: string;
  readonly category: DangerousToolCategory | null;
  readonly sessionKey: string;
  readonly requesterId: string | null;
  readonly turnId: string;
  /** 脱敏后的参数，供审批卡片展示。 */
  readonly args: DecisionPayload;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly status: ToolApprovalStatus;
  readonly decidedAt: number | null;
  /** 运营者 id（Console）或 `approval_port`（IM 审批提示）。 */
  readonly decidedBy: string | null;
}

export interface ToolApprovalEnqueueInput {
  readonly toolName: string;
  readonly category: DangerousToolCategory | null;
  readonly sessionKey: string;
  readonly requesterId?: string | null;
  readonly turnId: string;
  readonly args: Readonly<Record<string, unknown>>;
  /** 覆盖默认 ttl（毫秒）。 */
  readonly ttlMs?: number;
}

export interface ToolApprovalQueueOptions {
  readonly now?: () => number;
  /** 默认审批有效期（毫秒）；到期未批即拒绝。 */
  readonly ttlMs?: number;
  /** 最多保留条目数；超出时先丢最旧的已结束条目。 */
  readonly limit?: number;
}

export const DEFAULT_TOOL_APPROVAL_TTL_MS = 5 * 60_000;
const DEFAULT_LIMIT = 200;

interface MutableEntry {
  id: string;
  toolName: string;
  category: DangerousToolCategory | null;
  sessionKey: string;
  requesterId: string | null;
  turnId: string;
  args: DecisionPayload;
  fingerprint: string;
  createdAt: number;
  expiresAt: number;
  status: ToolApprovalStatus;
  decidedAt: number | null;
  decidedBy: string | null;
  waiters: Array<(settlement: ToolApprovalSettlement) => void>;
  timer?: ReturnType<typeof setTimeout>;
}

let sequence = 0;

export class ToolApprovalQueue {
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #limit: number;
  readonly #entries = new Map<string, MutableEntry>();

  constructor(options: ToolApprovalQueueOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#ttlMs = positive(options.ttlMs) ?? DEFAULT_TOOL_APPROVAL_TTL_MS;
    this.#limit = positive(options.limit) ?? DEFAULT_LIMIT;
  }

  /** 同一会话、同一工具、同一参数的稳定指纹。 */
  static fingerprint(sessionKey: string, toolName: string, args: Readonly<Record<string, unknown>>): string {
    return `${sessionKey}\u0000${toolName}\u0000${stableValue(args)}`;
  }

  /**
   * 建一张待审批卡片。同指纹已有 pending 卡片时复用它（无人值守重复调用不刷屏）。
   */
  enqueue(input: ToolApprovalEnqueueInput): ToolApprovalEntry {
    this.#expireDue();
    const fingerprint = ToolApprovalQueue.fingerprint(input.sessionKey, input.toolName, input.args);
    for (const entry of this.#entries.values()) {
      if (entry.fingerprint === fingerprint && entry.status === 'pending') return snapshot(entry);
    }
    const now = this.#now();
    const ttl = positive(input.ttlMs) ?? this.#ttlMs;
    sequence = (sequence + 1) % Number.MAX_SAFE_INTEGER;
    const entry: MutableEntry = {
      id: `tap_${now.toString(36)}_${sequence.toString(36)}`,
      toolName: input.toolName,
      category: input.category,
      sessionKey: input.sessionKey,
      requesterId: input.requesterId ?? null,
      turnId: input.turnId,
      args: redactDecisionPayload({ ...input.args }),
      fingerprint,
      createdAt: now,
      expiresAt: now + ttl,
      status: 'pending',
      decidedAt: null,
      decidedBy: null,
      waiters: [],
    };
    entry.timer = setTimeout(() => this.#settle(entry, 'expired', null), ttl);
    (entry.timer as { unref?: () => void }).unref?.();
    this.#entries.set(entry.id, entry);
    this.#prune();
    return snapshot(entry);
  }

  /** 等待卡片落定（批准 / 拒绝 / 超时）。已落定的卡片立即返回。 */
  wait(id: string, signal?: AbortSignal): Promise<ToolApprovalSettlement> {
    const entry = this.#entries.get(id);
    if (!entry) return Promise.resolve('expired');
    if (entry.status !== 'pending') return Promise.resolve(settlementOf(entry.status));
    return new Promise((resolve) => {
      const onAbort = () => resolve('denied');
      signal?.addEventListener('abort', onAbort, { once: true });
      entry.waiters.push((settlement) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(settlement);
      });
    });
  }

  /**
   * 运营者（Console）或审批端口给出结论。只有 pending 卡片可被处理；返回处理后的卡片，
   * 卡片不存在或已结束时返回 undefined。
   */
  resolve(id: string, approved: boolean, decidedBy: string): ToolApprovalEntry | undefined {
    this.#expireDue();
    const entry = this.#entries.get(id);
    if (!entry || entry.status !== 'pending') return undefined;
    this.#settle(entry, approved ? 'approved' : 'denied', decidedBy);
    return snapshot(entry);
  }

  /** 交互回合里本次调用已直接执行：标记已消费，避免之后被再次使用。 */
  markConsumed(id: string): void {
    const entry = this.#entries.get(id);
    if (entry && entry.status === 'approved') entry.status = 'consumed';
  }

  /**
   * 取出一张与本次调用同指纹、已批准且未过期的卡片，并一次性消费。
   * 无人值守回合靠它执行运营者在 Console 批准过的调用。
   */
  consumeApproved(sessionKey: string, toolName: string, args: Readonly<Record<string, unknown>>): ToolApprovalEntry | undefined {
    this.#expireDue();
    const fingerprint = ToolApprovalQueue.fingerprint(sessionKey, toolName, args);
    for (const entry of this.#entries.values()) {
      if (entry.fingerprint === fingerprint && entry.status === 'approved' && entry.expiresAt > this.#now()) {
        entry.status = 'consumed';
        return snapshot(entry);
      }
    }
    return undefined;
  }

  get(id: string): ToolApprovalEntry | undefined {
    this.#expireDue();
    const entry = this.#entries.get(id);
    return entry ? snapshot(entry) : undefined;
  }

  /** 新 → 旧；默认全部状态。 */
  list(filter: { status?: ToolApprovalStatus } = {}): readonly ToolApprovalEntry[] {
    this.#expireDue();
    return [...this.#entries.values()]
      .filter((entry) => !filter.status || entry.status === filter.status)
      .sort((left, right) => right.createdAt - left.createdAt)
      .map(snapshot);
  }

  dispose(): void {
    for (const entry of this.#entries.values()) {
      if (entry.status === 'pending') this.#settle(entry, 'expired', null);
    }
  }

  #settle(entry: MutableEntry, status: 'approved' | 'denied' | 'expired', decidedBy: string | null): void {
    if (entry.status !== 'pending') return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.status = status;
    entry.decidedAt = this.#now();
    entry.decidedBy = decidedBy;
    const waiters = entry.waiters.splice(0);
    for (const waiter of waiters) waiter(status);
  }

  #expireDue(): void {
    const now = this.#now();
    for (const entry of this.#entries.values()) {
      if (entry.status === 'pending' && entry.expiresAt <= now) this.#settle(entry, 'expired', null);
    }
  }

  #prune(): void {
    if (this.#entries.size <= this.#limit) return;
    const settled = [...this.#entries.values()]
      .filter((entry) => entry.status !== 'pending')
      .sort((left, right) => left.createdAt - right.createdAt);
    for (const entry of settled) {
      if (this.#entries.size <= this.#limit) return;
      this.#entries.delete(entry.id);
    }
  }
}

function settlementOf(status: ToolApprovalStatus): ToolApprovalSettlement {
  if (status === 'approved' || status === 'consumed') return 'approved';
  return status === 'denied' ? 'denied' : 'expired';
}

function snapshot(entry: MutableEntry): ToolApprovalEntry {
  return Object.freeze({
    id: entry.id,
    toolName: entry.toolName,
    category: entry.category,
    sessionKey: entry.sessionKey,
    requesterId: entry.requesterId,
    turnId: entry.turnId,
    args: entry.args,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
    status: entry.status,
    decidedAt: entry.decidedAt,
    decidedBy: entry.decidedBy,
  });
}

function positive(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableValue(entry)}`)
      .join(',')}}`;
  }
  if (typeof value === 'undefined') return 'undefined';
  try { return JSON.stringify(value); } catch { return String(value); }
}
