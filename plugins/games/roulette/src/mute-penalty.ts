import { outboundHostToken, type OutboundHost, type Token } from 'zhin.js';

/** Where a game was played, as stored on the session row. */
export interface PenaltyConversation {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly kind: string;
  readonly id: string;
}

export type MuteSupport =
  /** The Endpoint declares `muteGroupMember` and this is a group. */
  | 'supported'
  /** Muting only exists for group members (not private chats or channels). */
  | 'not-a-group'
  /** The Endpoint does not declare `muteGroupMember`, or no outbound host is installed. */
  | 'unsupported';

/**
 * The only mute surface the game uses. It never looks at adapter names: support
 * comes from the capability the live Endpoint declares through `OutboundHost`.
 */
export interface MutePenaltyPort {
  support(conversation: PenaltyConversation): MuteSupport;
  mute(conversation: PenaltyConversation, userId: string, durationSeconds: number): Promise<void>;
}

export function createOutboundMutePenalty(outbound: OutboundHost | undefined): MutePenaltyPort {
  return {
    support(conversation) {
      if (conversation.kind !== 'group') return 'not-a-group';
      if (!outbound?.muteGroupMember) return 'unsupported';
      const capabilities = outbound.capabilities?.({
        adapter: conversation.adapter,
        endpointKey: conversation.endpointKey,
      });
      const declared = capabilities?.management ?? [];
      return declared.includes('muteGroupMember') ? 'supported' : 'unsupported';
    },
    async mute(conversation, userId, durationSeconds) {
      if (!outbound?.muteGroupMember) {
        throw new Error('This runtime cannot mute group members');
      }
      await outbound.muteGroupMember({
        adapter: conversation.adapter,
        endpointKey: conversation.endpointKey,
        groupId: conversation.id,
        userId,
        durationSeconds,
      });
    },
  };
}

/** Builds the port from whatever outbound host the current runtime installed (maybe none). */
export function resolveMutePenalty(context: { use<T>(token: Token<T>): T }): MutePenaltyPort {
  return createOutboundMutePenalty(tryUse(context, outboundHostToken));
}

function tryUse<T>(context: { use<T>(token: Token<T>): T }, token: Token<T>): T | undefined {
  try {
    return context.use(token);
  } catch {
    return undefined;
  }
}
