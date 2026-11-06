import type { PeerRegistry } from '@zhin.js/adapter';
import type { ConversationRef } from '@zhin.js/im-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { readMentionSegmentTarget } from '../../built/segment-contract/mention.js';
import type { IncomingMessage, MessageSenderRef } from './contracts.js';
import { requireAdapters } from './endpoint-runtime.js';
import {
  ledgerScopeOf,
  roomMembershipToken,
  type RoomInboundRouteInput,
  type RoomMembershipPort,
} from './inbound-origin.js';
import type { InboundInteractionPort } from './inbound-spine.js';
import { actionPayloadFromSegments } from './interactive-router.js';
import { formatConversationLog } from './message-events.js';
export {
  roomMembershipToken,
  type ResolvedRoomInfo,
  type RoomArbitrationInput,
  type RoomClaimInput,
  type RoomInboundRouteInput,
  type RoomMembershipPort,
  type RoomReadinessResult,
  type RoomRouteDecision,
} from './inbound-origin.js';

const logger = getLogger('im.inbound');

/**
 * @internal 入站去重：同一条人类群消息会到达 N 个成员 Endpoint，
 * 按 平台 + 会话 + 发送者 + 平台消息 id 只放行第一个 Endpoint，其余仅记录。
 *
 * 只对 group / channel 生效。私聊刻意排除：部分平台（如 OneBot）的消息 id 是
 * 账号级的，两个 Bot 在同一私聊里可能拿到相同 id 的不同消息，去重会误合并。
 * 缺少发送者或消息 id 时同样不去重（保持原有路由行为）。
 */

const TTL_MS = 60_000;
const MAX_ENTRIES = 2000;

export type InboundClaim = 'first' | 'same_endpoint' | 'duplicate' | 'unkeyed';

interface ClaimEntry {
  readonly endpointId: string;
  readonly at: number;
}

/** Room Router decision as seen by the deduper (the Endpoint ids only). */
export interface InboundArbitrationDecision {
  readonly target: string;
  /** Takeover candidates after the target, by priority. */
  readonly fallbacks: readonly string[];
}

export type InboundArbitration =
  /** Not keyed (private chat / no sender / no message id): caller keeps per-Endpoint handling. */
  | { readonly kind: 'unkeyed' }
  /** Handle this copy. `routed` is true when the Room Router chose (or a fallback took over for) this Endpoint. */
  | { readonly kind: 'handle'; readonly routed: boolean }
  | { readonly kind: 'duplicate' }
  /** Non-target copy that arrived before the target: wait for the target or the grace period. */
  | {
    readonly kind: 'wait';
    readonly target: string;
    /** False when this Endpoint is neither the target nor in `fallbacks` (lowest-priority takeover candidate). */
    readonly listed: boolean;
    readonly settle: () => Promise<'handle' | 'duplicate'>;
  };

interface Waiter {
  readonly endpointId: string;
  readonly resolve: (outcome: 'handle' | 'duplicate') => void;
}

interface ArbitrationEntry {
  readonly at: number;
  readonly decision: InboundArbitrationDecision | undefined;
  /** Used when there is no decision (claim semantics). */
  readonly firstEndpoint: string;
  targetSeen: boolean;
  takenOverBy: string | undefined;
  waiters: Waiter[];
  timer: ReturnType<typeof setTimeout> | undefined;
}

const DEFAULT_GRACE_MS = 2000;

export class InboundDeduper {
  readonly #entries = new Map<string, ClaimEntry>();
  readonly #arbitrations = new Map<string, ArbitrationEntry>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly graceMs: number = DEFAULT_GRACE_MS,
  ) {}

  get size(): number {
    return this.#entries.size;
  }

  /**
   * 不变量：本方法完全同步，调用方必须在任何 await 之前调用，
   * 这样 N 个 Endpoint 的并发到达会被原子地判定。
   */
  claim(conversation: ConversationRef, senderId: string, messageId: unknown): InboundClaim {
    const key = this.#keyOf(conversation, senderId, messageId);
    if (key === undefined) return 'unkeyed';
    const at = this.now();
    this.#prune(at);
    const existing = this.#entries.get(key);
    if (existing) {
      return existing.endpointId === conversation.endpoint.id ? 'same_endpoint' : 'duplicate';
    }
    this.#entries.set(key, { endpointId: conversation.endpoint.id, at });
    while (this.#entries.size > MAX_ENTRIES) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    return 'first';
  }

  /**
   * Room 内按 Router 决策仲裁：目标 Endpoint 的副本处理，其余副本只记录；
   * 但目标可能根本没收到副本（如 Telegram 隐私模式），所以非目标副本不是立刻丢弃，
   * 而是等待目标到达，宽限期（`graceMs`）后由优先级最高的已到达成员 Endpoint 接管。
   *
   * 与 `claim` 同样完全同步（返回的 `settle` 才是异步的），必须在任何 await 之前调用。
   * `compute` 仅在第一个副本到达时调用一次，结果（含 undefined）按消息缓存。
   * `compute` 返回 undefined（无可用成员）时退化为 `claim` 语义：先到先得，同 Endpoint 重投仍处理。
   * decision 之外的 Endpoint 视为最低优先级的接管候选；非成员由 hasRoom 在 core 之外过滤。
   */
  arbitrate(
    conversation: ConversationRef,
    senderId: string,
    messageId: unknown,
    compute: () => InboundArbitrationDecision | undefined,
  ): InboundArbitration {
    const key = this.#keyOf(conversation, senderId, messageId);
    if (key === undefined) return { kind: 'unkeyed' };
    const at = this.now();
    this.#prune(at);
    const endpointId = conversation.endpoint.id;
    let entry = this.#arbitrations.get(key);
    if (!entry) {
      entry = {
        at,
        decision: compute(),
        firstEndpoint: endpointId,
        targetSeen: false,
        takenOverBy: undefined,
        waiters: [],
        timer: undefined,
      };
      this.#arbitrations.set(key, entry);
      while (this.#arbitrations.size > MAX_ENTRIES) {
        const oldest = this.#arbitrations.keys().next().value;
        if (oldest === undefined) break;
        this.#evict(oldest);
      }
    }
    const { decision } = entry;
    if (!decision) {
      return entry.firstEndpoint === endpointId
        ? { kind: 'handle', routed: false }
        : { kind: 'duplicate' };
    }
    if (endpointId === decision.target) {
      if (entry.takenOverBy !== undefined) return { kind: 'duplicate' };
      entry.targetSeen = true;
      this.#settleWaiters(entry, 'duplicate');
      return { kind: 'handle', routed: true };
    }
    if (entry.takenOverBy !== undefined) {
      return entry.takenOverBy === endpointId ? { kind: 'handle', routed: true } : { kind: 'duplicate' };
    }
    if (entry.targetSeen) return { kind: 'duplicate' };
    const target = entry.waiters;
    const settle = new Promise<'handle' | 'duplicate'>((resolve) => {
      target.push({ endpointId, resolve });
    });
    if (entry.timer === undefined) {
      const owned = entry;
      owned.timer = setTimeout(() => this.#takeOver(owned), this.graceMs);
      owned.timer.unref?.();
    }
    return {
      kind: 'wait',
      target: decision.target,
      listed: decision.fallbacks.includes(endpointId),
      settle: () => settle,
    };
  }

  #keyOf(conversation: ConversationRef, senderId: string, messageId: unknown): string | undefined {
    if (conversation.kind !== 'group' && conversation.kind !== 'channel') return undefined;
    if (typeof senderId !== 'string' || senderId === '') return undefined;
    if (typeof messageId !== 'string' && typeof messageId !== 'number') return undefined;
    const id = String(messageId);
    if (id === '') return undefined;
    return `${ledgerScopeOf(conversation)}\0${senderId}\0${id}`;
  }

  #settleWaiters(entry: ArbitrationEntry, outcome: 'duplicate'): void {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = undefined;
    const waiters = entry.waiters;
    entry.waiters = [];
    for (const waiter of waiters) waiter.resolve(outcome);
  }

  /** Synchronous: the best-priority waiting copy takes over unless the target showed up or someone already did. */
  #takeOver(entry: ArbitrationEntry): void {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = undefined;
    const waiters = entry.waiters;
    entry.waiters = [];
    const decision = entry.decision;
    if (!decision || entry.targetSeen || entry.takenOverBy !== undefined || waiters.length === 0) {
      for (const waiter of waiters) waiter.resolve('duplicate');
      return;
    }
    const rank = (id: string) => {
      const index = decision.fallbacks.indexOf(id);
      return index === -1 ? decision.fallbacks.length : index;
    };
    let winner = waiters[0]!;
    for (const waiter of waiters) {
      if (rank(waiter.endpointId) < rank(winner.endpointId)) winner = waiter;
    }
    entry.takenOverBy = winner.endpointId;
    for (const waiter of waiters) waiter.resolve(waiter === winner ? 'handle' : 'duplicate');
  }

  /** Dropping an entry must not strand a waiting copy: resolve it by taking over now. */
  #evict(key: string): void {
    const entry = this.#arbitrations.get(key);
    this.#arbitrations.delete(key);
    if (entry) this.#takeOver(entry);
  }

  #prune(at: number): void {
    for (const [key, entry] of this.#arbitrations) {
      if (at - entry.at <= TTL_MS) break;
      this.#evict(key);
    }
    for (const [key, entry] of this.#entries) {
      if (at - entry.at <= TTL_MS) break;
      this.#entries.delete(key);
    }
  }
}

/** Facts required to route this message within its captured account directory. */
export interface InboundRoomRouteRequest {
  readonly conversation: IncomingMessage['conversation'];
  readonly senderId: string;
  readonly input: IncomingMessage;
  readonly adapters: ReturnType<typeof requireAdapters>;
  readonly generation: number;
  readonly interactions: InboundInteractionPort;
  readonly registry?: Pick<PeerRegistry, 'isReady' | 'selfOf'>;
  readonly inboundClaimPending?: (conversation: IncomingMessage['conversation'], senderId: string) => boolean;
  readonly resolveReplyTarget?: (conversation: IncomingMessage['conversation'], messageId: string) => string | undefined;
}

export function buildRoomInboundRouteInput({
  conversation,
  senderId,
  input,
  adapters,
  generation,
  interactions,
  registry,
  inboundClaimPending,
  resolveReplyTarget,
}: InboundRoomRouteRequest): RoomInboundRouteInput {
  const mentionTargets = (input.segments ?? [])
    .map((segment) => readMentionSegmentTarget(segment as { type: unknown; data?: unknown }))
    .filter((target) => target !== '' && target !== 'all');
  const replyToId = input.replyTo?.id;
  const replyToEndpointId = replyToId !== undefined && resolveReplyTarget
    ? resolveReplyTarget(conversation, replyToId)
    : undefined;
  return {
    conversation,
    senderId,
    content: input.content,
    mentionTargets,
    ...(replyToEndpointId !== undefined ? { replyToEndpointId } : {}),
    pending: (endpointId) => {
      try {
        const adapter = adapters.clientAdapter(endpointId as CapabilityId);
        const probe = Object.freeze({ ...conversation, endpoint: Object.freeze({ id: endpointId, adapter }) });
        return interactions.hasPendingAnswer?.(
          probe, senderId, generation, { content: input.content, segments: input.segments },
        ) === true || inboundClaimPending?.(probe, senderId) === true;
      } catch {
        return false;
      }
    },
    accountOf: (endpointId) => registry?.selfOf(endpointId),
    isAvailable: (endpointId) => registry?.isReady(endpointId) === true,
  };
}

export async function arbitrateRoomInboundDeduplication(input: {
  readonly origin: string | undefined;
  readonly deduper?: Pick<InboundDeduper, 'claim'> & Partial<Pick<InboundDeduper, 'arbitrate'>>;
  readonly roomMembership: RoomMembershipPort | undefined;
  readonly conversation: IncomingMessage['conversation'];
  readonly enrichedSender: MessageSenderRef | undefined;
  readonly incoming: IncomingMessage;
  readonly routeRequest: InboundRoomRouteRequest;
}): Promise<{
  readonly recordOnly?: 'duplicate' | 'dedup_error';
  readonly routedTarget: boolean;
}> {
  const { origin, deduper, roomMembership, conversation, enrichedSender, incoming, routeRequest } = input;
  let recordOnly: 'duplicate' | 'dedup_error' | undefined;
  let routedTarget = false;
  let pendingSettle: { readonly target: string; readonly listed: boolean; readonly settle: () => Promise<'handle' | 'duplicate'> } | undefined;
  const platformCallback = actionPayloadFromSegments(incoming.segments) !== undefined;
  if ((origin === 'human' || origin === undefined) && deduper && !platformCallback
    && (conversation.kind === 'group' || conversation.kind === 'channel')) {
    try {
      if (roomMembership?.hasRoom?.(conversation) === true) {
        const senderId = String(enrichedSender?.id ?? '');
        if (typeof roomMembership.route === 'function' && typeof deduper.arbitrate === 'function') {
          const route = roomMembership.route.bind(roomMembership);
          const routeInput = buildRoomInboundRouteInput(routeRequest);
          const verdict = deduper.arbitrate(conversation, senderId, incoming.message?.id, () => {
            try {
              const decision = route(routeInput);
              return decision
                ? { target: decision.endpointId, fallbacks: decision.fallbackEndpointIds ?? [] }
                : undefined;
            } catch (error) {
              logger.warn(formatCompact({
                op: 'room_route_error',
                conv: formatConversationLog(conversation),
                error: error instanceof Error ? error.message : String(error),
              }));
              return undefined;
            }
          });
          switch (verdict.kind) {
            case 'handle':
              routedTarget = verdict.routed;
              break;
            case 'duplicate':
              recordOnly = 'duplicate';
              logger.debug(formatCompact({
                op: 'room_non_target_copy',
                conv: formatConversationLog(conversation),
              }));
              break;
            case 'wait':
              pendingSettle = verdict;
              break;
            case 'unkeyed':
              break;
          }
        } else {
          const claim = deduper.claim(conversation, senderId, incoming.message?.id);
          if (claim === 'duplicate') recordOnly = 'duplicate';
        }
      }
    } catch (error) {
      logger.warn(formatCompact({
        op: 'inbound_dedup_error',
        conv: formatConversationLog(conversation),
        error: error instanceof Error ? error.message : String(error),
      }));
      recordOnly = 'dedup_error';
    }
  }
  if (pendingSettle) {
    const outcome = await pendingSettle.settle();
    if (outcome === 'handle') {
      routedTarget = true;
      if (!pendingSettle.listed) {
        logger.warn(formatCompact({
          op: 'room_unlisted_member_takeover',
          conv: formatConversationLog(conversation),
          target: pendingSettle.target,
          takeover: conversation.endpoint.id,
        }));
      }
      logger.debug(formatCompact({
        op: 'room_target_missing_takeover',
        conv: formatConversationLog(conversation),
        target: pendingSettle.target,
        takeover: conversation.endpoint.id,
      }));
    } else {
      recordOnly = 'duplicate';
    }
  }
  return { recordOnly, routedTarget };
}

export function resolveRoomMembership(snapshot: RuntimeSnapshot): RoomMembershipPort | undefined {
  try {
    const candidate = snapshot.resources.get(snapshot.root)?.get(roomMembershipToken.id);
    return candidate
      && typeof candidate === 'object'
      && (
        typeof (candidate as RoomMembershipPort).isMember === 'function'
        || typeof (candidate as RoomMembershipPort).resolveRoom === 'function'
        || typeof (candidate as RoomMembershipPort).isRoomReady === 'function'
      )
      ? candidate as RoomMembershipPort
      : undefined;
  } catch {
    return undefined;
  }
}
