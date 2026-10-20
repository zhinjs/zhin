import { adapterFeatureId, resolveEndpointManagement } from 'zhin.js/adapter';

/**
 * Where a game was played: the exact Endpoint identity from `message.conversation.endpoint`
 * (adapter plugin owner + Endpoint capability id) plus the conversation itself.
 */
export interface PenaltyConversation {
  readonly endpointAdapter: string;
  readonly endpointId: string;
  readonly kind: string;
  readonly id: string;
}

export type MuteSupport =
  /** The live Endpoint's management port implements `muteGroupMember` and this is a group. */
  | 'supported'
  /** Muting only exists for group members (not private chats or channels). */
  | 'not-a-group'
  /** No adapter projection, no such Endpoint, or its management port cannot mute. */
  | 'unsupported';

/**
 * The only mute surface the game uses. It never looks at adapter names: support
 * is whatever the live Endpoint's platform-neutral `EndpointManagement` implements.
 */
export interface MutePenaltyPort {
  support(conversation: PenaltyConversation): MuteSupport;
  mute(conversation: PenaltyConversation, userId: string, durationSeconds: number): Promise<void>;
}

/** The capability context of a command, middleware or schedule run. */
export interface AdapterProjectionContext {
  project<T>(feature: typeof adapterFeatureId): T;
}

type MuteGroupMember = (groupId: string, userId: string, durationSeconds: number) => Promise<void>;

interface EndpointLookup {
  connection(adapter: string, endpointKey: string): unknown;
}

export function resolveMutePenalty(context: AdapterProjectionContext): MutePenaltyPort {
  return {
    support(conversation) {
      if (conversation.kind !== 'group') return 'not-a-group';
      return findMuteGroupMember(context, conversation) ? 'supported' : 'unsupported';
    },
    async mute(conversation, userId, durationSeconds) {
      const muteGroupMember = findMuteGroupMember(context, conversation);
      if (!muteGroupMember) {
        throw new Error('This Endpoint cannot mute group members');
      }
      await muteGroupMember(conversation.id, userId, durationSeconds);
    },
  };
}

/** project(adapterFeatureId) → connection(adapter, endpointId) → resolveEndpointManagement → muteGroupMember. */
function findMuteGroupMember(
  context: AdapterProjectionContext,
  conversation: PenaltyConversation,
): MuteGroupMember | undefined {
  const adapters = readAdapterProjection(context);
  if (!adapters) return undefined;
  if (!conversation.endpointAdapter || !conversation.endpointId) return undefined;
  let endpoint: unknown;
  try {
    endpoint = adapters.connection(conversation.endpointAdapter, conversation.endpointId);
  } catch {
    return undefined;
  }
  const management = resolveEndpointManagement(endpoint);
  const muteGroupMember = management?.muteGroupMember;
  if (typeof muteGroupMember !== 'function') return undefined;
  return muteGroupMember.bind(management);
}

function readAdapterProjection(context: AdapterProjectionContext): EndpointLookup | undefined {
  let projection: unknown;
  try {
    projection = context.project<unknown>(adapterFeatureId);
  } catch {
    // No Adapter Feature in this runtime: score only.
    return undefined;
  }
  if (!projection || typeof projection !== 'object') return undefined;
  const lookup = projection as Partial<EndpointLookup>;
  if (typeof lookup.connection !== 'function') return undefined;
  return lookup as EndpointLookup;
}
