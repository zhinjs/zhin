/**
 * 危险工具审批队列（ADR 0036 §3，切片 E）。
 *
 * 硬闸拦下的每一次危险调用都在这里留一张「审批卡片」：交互回合里它和 IM 审批提示同时等待，
 * 谁先给出结论算谁；无人值守回合直接 fail closed，卡片留给运营者在 Console 处理，
 * 批准后由**下一次同参数调用**一次性消费。超时默认拒绝。
 *
 * 只在进程内存中保存有限条目；参数先经 {@link redactDecisionPayload} 脱敏，不存密钥与提示词。
 *
 * G6（#1013）：同一张卡片可由 Console 或 IM 审批通道（私聊 / 专用审批群）结算，任一渠道先到算数；
 * 结算时记录 `channel`，审计据此区分渠道。新卡片通过 {@link ToolApprovalQueue.onEnqueue} 通知 IM 投递。
 */
import { redactDecisionPayload, type DecisionPayload } from '../decision-events.js';
import type { DangerousToolCategory } from './tool-hard-gate.js';

export type ToolApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'consumed';
export type ToolApprovalSettlement = 'approved' | 'denied' | 'expired';
/** 人工结算卡片的渠道（G6 审计 `channel`）。 */
export type ToolApprovalChannel = 'console' | 'im_dm' | 'im_approver_group';

export const TOOL_APPROVAL_CHANNELS: readonly ToolApprovalChannel[] = Object.freeze(['console', 'im_dm', 'im_approver_group']);

/** 触发危险调用的会话；IM 审批通道据此选择投递 Endpoint，并拒绝在业务会话内结算。 */
export interface ToolApprovalOrigin {
  /** Adapter 本地名（如 `icqq`）。 */
  readonly platform: string;
  /** Endpoint 的 live 名（如 Bot uin）。 */
  readonly endpointKey: string;
  /** `private` / `group` / `channel`；非 IM 来源（如 Console 试聊）为 undefined。 */
  readonly scope?: 'private' | 'group' | 'channel';
  /** 原生会话 id（群号 / 频道 id / 私聊对端 id）。 */
  readonly sceneId: string;
}

export type ToolApprovalEnqueueListener = (entry: ToolApprovalEntry) => void;

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
  /**
   * 结算者：Console 运营者 id（暂为 `console`）、IM 审批人 `im:<platform>:<userId>`、
   * `approval_port`（回合内审批提示）或 `timeout` / `turn_cancelled`。
   */
  readonly decidedBy: string | null;
  /** 人工结算渠道；超时 / 回合内审批提示结算时为 null。 */
  readonly channel: ToolApprovalChannel | null;
  /** 触发调用的会话；缺省表示来源不可投递（IM 通道不可用，仅 Console）。 */
  readonly origin: ToolApprovalOrigin | null;
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
  readonly origin?: ToolApprovalOrigin | null;
}

export interface ToolApprovalResolveOptions {
  readonly channel?: ToolApprovalChannel;
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
  channel: ToolApprovalChannel | null;
  origin: ToolApprovalOrigin | null;
  waiters: Array<(settlement: ToolApprovalSettlement) => void>;
  timer?: ReturnType<typeof setTimeout>;
}

let sequence = 0;

export class ToolApprovalQueueClosedError extends Error {
  constructor() { super('Tool approval queue is closed'); this.name = 'ToolApprovalQueueClosedError'; }
}

export class ToolApprovalQueue {
  #closed = false;
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #limit: number;
  readonly #entries = new Map<string, MutableEntry>();
  readonly #enqueueListeners = new Set<ToolApprovalEnqueueListener>();

  constructor(options: ToolApprovalQueueOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#ttlMs = positive(options.ttlMs) ?? DEFAULT_TOOL_APPROVAL_TTL_MS;
    this.#limit = positive(options.limit) ?? DEFAULT_LIMIT;
  }

  /** Closing this owning Agent's queue is terminal; its chat cancellation remains independent. */
  get closed(): boolean { return this.#closed; }

  /** 同一会话、同一工具、同一参数的稳定指纹。 */
  static fingerprint(sessionKey: string, toolName: string, args: Readonly<Record<string, unknown>>): string {
    return `${sessionKey}\u0000${toolName}\u0000${stableValue(args)}`;
  }

  /**
   * 建一张待审批卡片。同指纹已有 pending 卡片时复用它（无人值守重复调用不刷屏）。
   */
  enqueue(input: ToolApprovalEnqueueInput): ToolApprovalEntry {
    if (this.#closed) throw new ToolApprovalQueueClosedError();
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
      channel: null,
      origin: input.origin ? freezeOrigin(input.origin) : null,
      waiters: [],
    };
    entry.timer = setTimeout(() => this.#settle(entry, 'expired', null, null), ttl);
    (entry.timer as { unref?: () => void }).unref?.();
    this.#entries.set(entry.id, entry);
    this.#prune();
    const created = snapshot(entry);
    this.#notifyEnqueued(created);
    return created;
  }

  /**
   * 订阅新建的待审批卡片（复用的同指纹卡片不再通知）。监听器同步调用，抛错被吞掉，
   * 不影响硬闸判定；返回退订函数。
   */
  onEnqueue(listener: ToolApprovalEnqueueListener): () => void {
    this.#enqueueListeners.add(listener);
    return () => {
      this.#enqueueListeners.delete(listener);
    };
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
   * 运营者（Console / IM 审批通道）或审批端口给出结论。只有 pending 卡片可被处理；返回处理后的卡片，
   * 卡片不存在或已结束时返回 undefined（多渠道竞态时后到者拿到 undefined）。
   */
  resolve(id: string, approved: boolean, decidedBy: string, options: ToolApprovalResolveOptions = {}): ToolApprovalEntry | undefined {
    this.#expireDue();
    const entry = this.#entries.get(id);
    if (!entry || entry.status !== 'pending') return undefined;
    this.#settle(entry, approved ? 'approved' : 'denied', decidedBy, options.channel ?? null);
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
    if (this.#closed) return undefined;
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

  /** 同指纹的 pending 卡片（{@link enqueue} 会复用它）；没有则 undefined。 */
  findPending(sessionKey: string, toolName: string, args: Readonly<Record<string, unknown>>): ToolApprovalEntry | undefined {
    this.#expireDue();
    const fingerprint = ToolApprovalQueue.fingerprint(sessionKey, toolName, args);
    for (const entry of this.#entries.values()) {
      if (entry.fingerprint === fingerprint && entry.status === 'pending') return snapshot(entry);
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
    this.#closed = true;
    for (const entry of this.#entries.values()) {
      if (entry.status === 'pending') this.#settle(entry, 'expired', null, null);
    }
    this.#enqueueListeners.clear();
  }

  #notifyEnqueued(entry: ToolApprovalEntry): void {
    for (const listener of [...this.#enqueueListeners]) {
      try {
        listener(entry);
      } catch {
        // 通知渠道不是门禁：投递失败不影响入队与判定。
      }
    }
  }

  #settle(
    entry: MutableEntry,
    status: 'approved' | 'denied' | 'expired',
    decidedBy: string | null,
    channel: ToolApprovalChannel | null,
  ): void {
    if (entry.status !== 'pending') return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.status = status;
    entry.decidedAt = this.#now();
    entry.decidedBy = decidedBy;
    entry.channel = channel;
    const waiters = entry.waiters.splice(0);
    for (const waiter of waiters) waiter(status);
  }

  #expireDue(): void {
    const now = this.#now();
    for (const entry of this.#entries.values()) {
      if (entry.status === 'pending' && entry.expiresAt <= now) this.#settle(entry, 'expired', null, null);
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
    channel: entry.channel,
    origin: entry.origin,
  });
}

function freezeOrigin(origin: ToolApprovalOrigin): ToolApprovalOrigin {
  return Object.freeze({
    platform: origin.platform,
    endpointKey: origin.endpointKey,
    ...(origin.scope ? { scope: origin.scope } : {}),
    sceneId: origin.sceneId,
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
