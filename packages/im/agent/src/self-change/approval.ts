/**
 * 受控自我进化：审批（ADR 0040 §4，切片 D）。
 *
 * - 试跑通过（`ready`）的变更由宿主提交：`ready → pending`，同时在 G6 {@link ToolApprovalQueue} 建一张
 *   类别 `self` 的审批卡，参数只含 `changeId` / `contentHash` / 预览摘要（不含文件正文）。卡片与硬闸卡
 *   同一队列：IM 私聊 / 审批群与 Console 任一渠道先结算算数。
 * - **永远是新鲜人批**：只认带人工渠道（`console` / `im_dm` / `im_approver_group`）的批准；回合内审批端口、
 *   bypass、自动审核都不会结算这张卡（它不是任何工具调用，硬闸的同参数消费也对不上）。没有渠道的「批准」按驳回处理。
 * - 批准绑定 `content_hash`：结算时变更内容与卡片上的摘要不一致 → `rejected`（`change_hash_mismatch`）。
 * - 同一发起会话同时最多 1 个 `pending`；默认 24 小时超时 → `expired`。
 * - 队列只在内存里：每次启动 {@link SelfChangeApprovals.restore} 为磁盘上仍 `pending` 的变更按剩余时限重建卡片。
 *
 * 批准后停在 `approved`，经 `onApproved` 交给生效（快照、写入、热重载 / 重启、回报，见 `apply.ts`）。
 */
import type { DecisionActor, DecisionReasonCode } from '../decision-events.js';
import {
  TOOL_APPROVAL_CHANNELS,
  type ToolApprovalChannel,
  type ToolApprovalEntry,
  type ToolApprovalOrigin,
  type ToolApprovalQueue,
} from '../security/tool-approval-queue.js';
import { DEFAULT_CHANGE_IDLE_TTL_MS } from './policy.js';
import type { SelfChangePreview } from './preview.js';
import { SelfChangeNotFoundError, SelfChangeStateError, type SelfChangeOrigin, type SelfChangeRecord, type SelfChangeStore } from './store.js';

/** 审批卡上的 `toolName`；不是可调用的工具名。 */
export const SELF_CHANGE_APPROVAL_TOOL = 'self_change';

/** 审批卡参数（脱敏后存进队列，供 IM 卡片与 Console 展示）。 */
export interface SelfChangeApprovalArgs {
  readonly changeId: string;
  readonly contentHash: string;
  readonly summary: string | null;
  readonly files: readonly { readonly path: string; readonly kind: string; readonly added: number; readonly removed: number }[];
  readonly configPaths: readonly string[];
  readonly impact: string;
  readonly impactDetail: readonly string[];
  readonly trial: string;
}

export class SelfChangePendingLimitError extends Error {
  /** 同会话里已在等待审批的变更。 */
  readonly pendingId: string;
  constructor(pendingId: string) {
    super(`change ${pendingId} from this conversation is still waiting for approval`);
    this.pendingId = pendingId;
    this.name = 'SelfChangePendingLimitError';
  }
}

export interface SelfChangeApprovalsOptions {
  readonly store: SelfChangeStore;
  readonly queue: ToolApprovalQueue;
  /** 审批时限；默认 24 小时（与 `pending` 闲置清理同一时限）。 */
  readonly ttlMs?: number;
  readonly now?: () => number;
  readonly onError?: (error: unknown) => void;
  /** 结算为 `approved` 后调用（切片 E：交给 {@link import('./apply.js').SelfChangeApplier} 生效）。出错只上报。 */
  readonly onApproved?: (record: SelfChangeRecord) => void | Promise<void>;
}

export interface SelfChangeSubmitOptions {
  readonly turnId?: string;
}

export interface SelfChangeDecisionResult {
  readonly record: SelfChangeRecord;
  readonly approvalId: string;
}

export class SelfChangeApprovals {
  readonly #store: SelfChangeStore;
  readonly #queue: ToolApprovalQueue;
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #onError: (error: unknown) => void;
  readonly #onApproved?: (record: SelfChangeRecord) => void | Promise<void>;
  /** changeId → 审批卡 id。 */
  readonly #cards = new Map<string, string>();
  /** changeId → 结算写回（Console 等它完成后再返回）。 */
  readonly #settling = new Map<string, Promise<SelfChangeRecord | null>>();
  readonly #aborts = new AbortController();
  #tail: Promise<unknown> = Promise.resolve();

  constructor(options: SelfChangeApprovalsOptions) {
    this.#store = options.store;
    this.#queue = options.queue;
    this.#ttlMs = options.ttlMs ?? DEFAULT_CHANGE_IDLE_TTL_MS;
    this.#now = options.now ?? Date.now;
    this.#onError = options.onError ?? (() => undefined);
    this.#onApproved = options.onApproved;
  }

  /** 发起会话里仍在等待审批的变更（每个会话最多 1 个）。 */
  async pendingFor(origin: Pick<SelfChangeOrigin, 'platform' | 'sceneId'>): Promise<SelfChangeRecord | null> {
    for (const record of await this.#store.list()) {
      if (record.status === 'pending' && sameConversation(record.origin, origin)) return record;
    }
    return null;
  }

  /**
   * 把 `ready` 的变更提交审批。同会话已有 `pending` 时抛 {@link SelfChangePendingLimitError}，变更保持 `ready`
   * （24 小时未提交按 §6a 过期清理）。
   */
  submit(id: string, options: SelfChangeSubmitOptions = {}): Promise<SelfChangeDecisionResult> {
    return this.#serialize(async () => {
      const current = await this.#store.get(id);
      if (!current) throw new SelfChangeNotFoundError(id);
      if (current.status !== 'ready') throw new SelfChangeStateError(current.status, 'be submitted');
      const pending = await this.pendingFor(current.origin);
      if (pending) throw new SelfChangePendingLimitError(pending.id);
      const record = await this.#store.transition(id, 'pending', {
        actor: 'policy',
        actorId: current.origin.userId,
        ...(options.turnId ? { turnId: options.turnId } : {}),
      });
      const card = this.#enqueue(record, this.#ttlMs, options.turnId);
      return { record, approvalId: card.id };
    });
  }

  /**
   * 启动时调用：为仍 `pending` 的变更按剩余时限重建审批卡（重新投递给审批人）；已超时的直接 `expired`。
   * 返回重建的卡片数。
   */
  restore(): Promise<number> {
    return this.#serialize(async () => {
      let restored = 0;
      for (const record of await this.#store.list()) {
        if (record.status !== 'pending' || this.#cards.has(record.id)) continue;
        const remaining = (record.submittedAt ?? record.updatedAt) + this.#ttlMs - this.#now();
        try {
          if (remaining <= 0) {
            await this.#store.transition(record.id, 'expired', { actor: 'policy', error: 'approval timed out' });
            continue;
          }
          this.#enqueue(record, remaining);
          restored += 1;
        } catch (error) {
          this.#onError(error);
        }
      }
      return restored;
    });
  }

  /** 变更当前的审批卡 id（未提交或已结算后重启则为 undefined）。 */
  approvalIdFor(changeId: string): string | undefined {
    return this.#cards.get(changeId);
  }

  /**
   * Console 按变更 id 结算（同一张卡，与 IM 渠道先到算数）。返回写回后的变更；卡片已被别的渠道结算时
   * 抛 {@link SelfChangeStateError}。
   */
  async decide(changeId: string, approve: boolean, decidedBy: string, channel: ToolApprovalChannel): Promise<SelfChangeRecord> {
    const approvalId = this.#cards.get(changeId);
    const current = await this.#store.get(changeId);
    if (!current) throw new SelfChangeNotFoundError(changeId);
    if (!approvalId || current.status !== 'pending') throw new SelfChangeStateError(current.status, 'be decided');
    const settled = this.#queue.resolve(approvalId, approve, decidedBy, { channel });
    if (!settled) throw new SelfChangeStateError(current.status, 'be decided twice');
    const record = await this.#settling.get(changeId);
    return record ?? (await this.#store.get(changeId)) ?? current;
  }

  /** 等所有已结算的卡片写回完成（测试与有序关闭）。 */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.#settling.values()]);
  }

  dispose(): void {
    this.#aborts.abort();
    this.#cards.clear();
  }

  #enqueue(record: SelfChangeRecord, ttlMs: number, turnId?: string): ToolApprovalEntry {
    const entry = this.#queue.enqueue({
      toolName: SELF_CHANGE_APPROVAL_TOOL,
      category: 'self',
      sessionKey: `self-change:${record.origin.platform}:${record.origin.sceneId}`,
      requesterId: record.origin.userId,
      turnId: turnId ?? `self-change:${record.id}`,
      args: selfChangeApprovalArgs(record) as unknown as Record<string, unknown>,
      ttlMs,
      origin: approvalOrigin(record.origin),
    });
    this.#cards.set(record.id, entry.id);
    const settle = this.#queue.wait(entry.id, this.#aborts.signal)
      .then(() => this.#aborts.signal.aborted ? null : this.#settle(record.id, entry.id))
      .catch((error) => {
        this.#onError(error);
        return null;
      })
      .finally(() => {
        if (this.#cards.get(record.id) === entry.id) this.#cards.delete(record.id);
      });
    this.#settling.set(record.id, settle);
    void settle.finally(() => {
      if (this.#settling.get(record.id) === settle) this.#settling.delete(record.id);
    });
    return entry;
  }

  async #settle(changeId: string, approvalId: string): Promise<SelfChangeRecord | null> {
    const card = this.#queue.get(approvalId);
    const current = await this.#store.get(changeId);
    // 已被清理过期或别处推进：卡片结论不再适用。
    if (!card || !current || current.status !== 'pending') return current;
    const status = card.status;
    if (status === 'pending') return current;
    // 队列随旧 generation 释放时会把未结卡片记为过期：那不是超时，留给新一代 `restore()` 重建。
    if (status === 'expired' && card.expiresAt > this.#now()) return current;
    const auditPayload = { approvalId, channel: card.channel, decidedBy: card.decidedBy };
    if (status === 'expired') {
      return this.#store.transition(changeId, 'expired', { actor: 'policy', error: 'approval timed out', auditPayload });
    }
    const human = card.channel !== null && TOOL_APPROVAL_CHANNELS.includes(card.channel) && Boolean(card.decidedBy);
    const actor: DecisionActor = human ? 'operator' : 'policy';
    if (status === 'denied' || !human) {
      return this.#store.transition(changeId, 'rejected', {
        actor,
        actorId: card.decidedBy,
        error: human ? 'rejected by approver' : 'approval without a human channel is not accepted',
        auditPayload,
      });
    }
    const boundHash = (card.args as { contentHash?: unknown }).contentHash;
    if (boundHash !== current.contentHash) {
      const reasonCode: DecisionReasonCode = 'change_hash_mismatch';
      return this.#store.transition(changeId, 'rejected', { actor, actorId: card.decidedBy, reasonCode, error: 'content changed after the approval card was issued', auditPayload });
    }
    const approved = await this.#store.transition(changeId, 'approved', { actor, actorId: card.decidedBy, approvedBy: card.decidedBy, auditPayload });
    if (this.#onApproved) {
      // 生效可能热重载 / 重启并释放本代审批对象：不等它，也不让它的失败影响结算结果。
      void Promise.resolve().then(() => this.#onApproved?.(approved)).catch(error => this.#onError(error));
    }
    return approved;
  }

  #serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(task, task);
    this.#tail = run.catch(() => undefined);
    return run;
  }
}

/** 卡片参数：预览摘要与试跑结论，不含文件正文与配置值。 */
export function selfChangeApprovalArgs(record: SelfChangeRecord): SelfChangeApprovalArgs {
  const preview = isPreview(record.plan) ? record.plan : null;
  const files = preview
    ? preview.files.map(file => ({ path: file.path, kind: file.kind, added: file.added, removed: file.removed }))
    : record.files.map(file => ({ path: file.path, kind: file.op === 'delete' ? 'delete' : 'write', added: 0, removed: 0 }));
  const impact = preview?.impact;
  const trial = record.trial as { passed?: unknown; checks?: readonly { status?: unknown }[] } | null;
  const skipped = Array.isArray(trial?.checks) ? trial.checks.filter(check => check?.status === 'skipped').length : 0;
  return Object.freeze({
    changeId: record.id,
    contentHash: record.contentHash,
    summary: preview?.summary ?? null,
    files: Object.freeze(files),
    configPaths: Object.freeze(record.configPatch?.patches.map(patch => `${patch.op} ${patch.path.join('.')}`) ?? []),
    impact: impact ? `${impact.kind}${impact.estimated ? ' (estimated)' : ''}` : 'unknown',
    impactDetail: Object.freeze(impact
      ? [...impact.subtrees.map(subtree => `reload ${subtree}`), ...(impact.kind === 'process' ? impact.reasons : [])].slice(0, 10)
      : []),
    trial: trial?.passed === true ? `passed${skipped ? ` (${skipped} skipped)` : ''}` : 'unknown',
  });
}

/** 变更发起会话 → 审批卡来源（IM 通道据此选 Endpoint、拒绝在业务会话内结算）。 */
export function approvalOrigin(origin: SelfChangeOrigin): ToolApprovalOrigin | null {
  if (!origin.endpoint) return null;
  const split = origin.sceneId.indexOf(':');
  const scope = split > 0 ? origin.sceneId.slice(0, split) : '';
  const sceneId = split > 0 ? origin.sceneId.slice(split + 1) : origin.sceneId;
  return Object.freeze({
    platform: origin.platform,
    endpointKey: origin.endpoint,
    ...(scope === 'private' || scope === 'group' || scope === 'channel' ? { scope } : {}),
    sceneId,
  });
}

function sameConversation(left: Pick<SelfChangeOrigin, 'platform' | 'sceneId'>, right: Pick<SelfChangeOrigin, 'platform' | 'sceneId'>): boolean {
  return left.platform === right.platform && left.sceneId === right.sceneId;
}

function isPreview(value: unknown): value is SelfChangePreview {
  return Boolean(value) && typeof value === 'object' && (value as { version?: unknown }).version === 1
    && Array.isArray((value as { files?: unknown }).files) && typeof (value as { impact?: unknown }).impact === 'object';
}
