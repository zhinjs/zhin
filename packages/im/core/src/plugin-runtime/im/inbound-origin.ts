import { createToken, type CapabilityId } from '@zhin.js/plugin-runtime';
import type { ConversationRef } from '@zhin.js/im-contract';
import type { PeerRegistry } from '@zhin.js/adapter';
import { getLogger } from '@zhin.js/logger';
import { ledgerScopeOf, type OutboundLedger } from './outbound-ledger.js';

const logger = getLogger('im.inbound.origin');

/** 入站消息来源。仅 `human` 能触发 agent turn；其余只记录。 */
export type MessageOrigin = 'self' | 'member' | 'peer_bot' | 'human';

/** @internal */
export const MESSAGE_ORIGINS: readonly MessageOrigin[] = Object.freeze(['self', 'member', 'peer_bot', 'human']);

export function isMessageOrigin(value: unknown): value is MessageOrigin {
  return typeof value === 'string' && (MESSAGE_ORIGINS as readonly string[]).includes(value);
}

/**
 * Room 成员端口。由 Room 激活（后续条目，workroom）通过 root resources 提供；
 * 未提供时没有任何 member：Registry 命中的账号全部是 `peer_bot`。
 * core 不导入 workroom，故以 Token 端口注入。
 */
export interface RoomMembershipPort {
  isMember(
    peer: { adapter: string; userId: string; endpointIds: readonly CapabilityId[] },
    conversation: ConversationRef,
  ): boolean;
  /**
   * 该会话是否属于某个启用的 Room。仅当返回 true 时，入站才做跨 Endpoint 去重 / 路由；
   * 应按“会话 + 接收 Endpoint（`conversation.endpoint`）”的成员关系判定：同一会话里
   * 非成员 Endpoint 收到的副本必须返回 false，按普通群自行处理；
   * 缺省（未实现）等同 false：普通群保持每个 Endpoint 各自处理。
   *
   * `hasRoom` 与 `route` 必须成对实现（B2b Room Router 已实现）：去重落败的 Endpoint 上
   * 待回答的 interaction / prompt 与 @ 只有在 `route` 把目标 Endpoint 解析出来时才会被消费。
   * 仅实现 `hasRoom` 而没有 `route` 时回退到 B2 的先到先得，落败 Endpoint 上的状态不会被消费。
   *
   * 带 action 段的入站（平台按钮回调）不经过 hasRoom / route：它只投递给发出键盘的那个 Endpoint，
   * 永远由接收它的 Endpoint 处理。
   */
  hasRoom?(conversation: ConversationRef): boolean;
  /**
   * Room 内一条人类群消息应由哪个成员 Endpoint 处理。必须同步、无副作用。
   *
   * 返回 `undefined`（无可用成员）退化为先到先得。抛错同样退化为先到先得并告警（不丢消息）。
   * Router 只能保证“实际收到副本的成员 Endpoint”里有人处理：core 无法预知哪些 Endpoint 会收到副本
   * （例如 Telegram 隐私模式下未 @ 的消息只投递给部分 Bot），所以目标没收到副本时，
   * `fallbackEndpointIds` 中的成员在宽限期后按优先级接管。决策按消息缓存，每条消息只决定一次。
   */
  route?(input: RoomInboundRouteInput): RoomRouteDecision | undefined;
}

/** core 用可信数据构造的路由输入；不信任正文。 */
export interface RoomInboundRouteInput {
  /** 接收副本的会话（endpoint 为接收副本的 Endpoint）。 */
  readonly conversation: ConversationRef;
  readonly senderId: string;
  readonly content: string;
  /** 取自 segments 中 `type==='mention'` 的 `data.target`。 */
  readonly mentionTargets: readonly string[];
  /** 被回复的消息若是本进程某 Bot 发的（出站 ledger 命中），为该 Bot 的 Endpoint id。 */
  readonly replyToEndpointId?: string;
  /** 该 Endpoint 上该发送者是否有待回答的 interaction / claim / prompt。 */
  pending(endpointId: string): boolean;
  /** Endpoint 的 Bot 账号（registry.selfOf）。 */
  accountOf(endpointId: string): string | undefined;
  /** Endpoint 是否就绪（registry.isReady）。 */
  isAvailable(endpointId: string): boolean;
}

export interface RoomRouteDecision {
  readonly endpointId: string;
  readonly reason: 'pending' | 'mention' | 'reply' | 'coordinator' | 'role';
  /** 目标之后的其余可用成员 Endpoint，按接管优先级排序（不含目标）。 */
  readonly fallbackEndpointIds: readonly string[];
}

export const roomMembershipToken = createToken<RoomMembershipPort>('zhin.im.room-membership');

/** @internal */
export type OriginBasis = 'registry' | 'ledger' | 'none' | 'error';

/** @internal */
export interface InboundOriginInput {
  readonly conversation: ConversationRef;
  readonly sender?: { readonly id?: unknown } | undefined;
  readonly messageId?: unknown;
  readonly content?: string;
}

/** @internal */
export interface InboundOriginResult {
  readonly origin: MessageOrigin;
  readonly basis: OriginBasis;
  /**
   * 接收 Endpoint 是否已向 Registry 上报账号。供 Room 激活使用
   * （“Registry 未就绪的 Endpoint，它所在的 Room 不开始协作”，后续条目）；
   * 普通会话不据此判非 human，否则未上报 selfUserId 的适配器会全部失效。
   */
  readonly ready: boolean;
}

/** @internal */
export interface InboundOriginClassifier {
  classify(input: InboundOriginInput, membership?: RoomMembershipPort): InboundOriginResult;
}

/** @internal */
export interface InboundOriginClassifierOptions {
  readonly registry: Pick<PeerRegistry, 'lookup' | 'isReady' | 'selfOf'>;
  readonly ledger: OutboundLedger;
}

/** @internal */
export function createInboundOriginClassifier(options: InboundOriginClassifierOptions): InboundOriginClassifier {
  const { registry, ledger } = options;
  return {
    classify(input, membership) {
      let ready = false;
      try {
        const { conversation } = input;
        const endpointId = conversation.endpoint.id;
        const adapter = conversation.endpoint.adapter;
        ready = registry.isReady(endpointId);
        const scope = ledgerScopeOf(conversation);
        const rawSender = input.sender?.id;
        const senderId = typeof rawSender === 'string' || typeof rawSender === 'number'
          ? String(rawSender).trim()
          : '';

        const mapForeign = (foreignEndpointId: string, basis: OriginBasis): InboundOriginResult => {
          if (foreignEndpointId === endpointId) return { origin: 'self', basis, ready };
          const peer = senderId === '' ? undefined : registry.lookup(adapter, senderId);
          const isMember = membership?.isMember(
            { adapter, userId: senderId, endpointIds: peer?.endpointIds ?? [foreignEndpointId as CapabilityId] },
            conversation,
          ) === true;
          return { origin: isMember ? 'member' : 'peer_bot', basis, ready };
        };

        const byId = ledger.matchById(scope, input.messageId);
        if (byId) return mapForeign(byId.endpointId, 'ledger');
        if (senderId === '') return { origin: 'human', basis: 'none', ready };

        if (registry.selfOf(endpointId) === senderId) return { origin: 'self', basis: 'registry', ready };
        const peer = registry.lookup(adapter, senderId);
        if (peer) {
          const isMember = membership?.isMember(
            { adapter: peer.adapter, userId: peer.userId, endpointIds: peer.endpointIds },
            conversation,
          ) === true;
          return { origin: isMember ? 'member' : 'peer_bot', basis: 'registry', ready };
        }

        // Digest fallback: group/channel only, and only while the endpoint's account is unknown.
        // Reaching here means the sender is not self and not in the Registry; if the endpoint is
        // ready with a known account, the sender is a known human, so skip (and keep the one-shot
        // digest unconsumed). A digest hit is at worst record-only and never maps to `self`.
        // Private conversations are excluded on purpose, even when this Endpoint is not ready
        // (selfUserId unknown): a private echo of our own message is classified `human`
        // (basis 'none', ready=false) instead of digest-matched. Trade-off: a private chat has one
        // counterpart and no peer bots, so guessing by digest would risk tagging a real user who
        // repeats bot text as peer_bot; the echo is only suppressed once the account or ledger id is known.
        const digestEligible = (conversation.kind === 'group' || conversation.kind === 'channel')
          && !(ready && registry.selfOf(endpointId) !== undefined);
        if (digestEligible && typeof input.content === 'string') {
          const byDigest = ledger.matchByDigest(scope, input.content);
          if (byDigest) {
            const isMember = membership?.isMember(
              { adapter, userId: senderId, endpointIds: [byDigest.endpointId as CapabilityId] },
              conversation,
            ) === true;
            return { origin: isMember ? 'member' : 'peer_bot', basis: 'ledger', ready };
          }
        }
        return { origin: 'human', basis: 'none', ready };
      } catch (error) {
        // Fail closed: undecidable is neither human nor self/member; record only.
        try {
          logger.warn(`origin classification failed: ${error instanceof Error ? error.message : String(error)}`);
        } catch { /* logging must not throw */ }
        return { origin: 'peer_bot', basis: 'error', ready };
      }
    },
  };
}
