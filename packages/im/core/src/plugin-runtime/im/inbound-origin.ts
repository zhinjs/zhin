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
