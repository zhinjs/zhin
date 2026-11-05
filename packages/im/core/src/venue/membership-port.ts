import type { CapabilityId } from '@zhin.js/plugin-runtime';
import type { ConversationRef } from '@zhin.js/im-contract';
import type {
  ResolvedRoomInfo,
  RoomArbitrationInput,
  RoomClaimInput,
  RoomInboundRouteInput,
  RoomMembershipPort,
  RoomReadinessResult,
  RoomRouteDecision,
} from '../plugin-runtime/im/inbound-dedup.js';
import type { VenueDefinition } from './contracts.js';
import type { VenueRegistry } from './registry.js';
import { findEarliestMemberTextMention, resolveVenueEntryMember, routeVenueMessage } from './router.js';

export interface CreateVenueMembershipPortOptions {
  readonly registry: VenueRegistry;
  readonly resolveEndpointSelfId?: (platform: string, endpointId: string) => string | undefined;
}

export interface VenueMembershipPort extends RoomMembershipPort {
  resolveRoom(input: RoomClaimInput): ResolvedRoomInfo | undefined;
  isAddressedEndpoint(input: RoomArbitrationInput): boolean;
  isRoomReady(input: RoomClaimInput): RoomReadinessResult;
  isMember(
    peer: { adapter: string; userId: string; endpointIds: readonly CapabilityId[] },
    conversation: ConversationRef,
  ): boolean;
  hasRoom(conversation: ConversationRef): boolean;
  route(input: RoomInboundRouteInput): RoomRouteDecision | undefined;
}

export function findUnreadyVenueEndpoints(
  venue: VenueDefinition,
  resolveEndpointSelfId: (platform: string, endpointId: string) => string | undefined,
): readonly string[] {
  const unready: string[] = [];
  for (const member of venue.members) {
    const selfId = resolveEndpointSelfId(venue.conversation.platform, member.botEndpoint);
    if (typeof selfId !== 'string' || selfId.trim() === '') {
      unready.push(member.botEndpoint);
    }
  }
  return Object.freeze(unready);
}

export function createVenueMembershipPort(options: CreateVenueMembershipPortOptions): VenueMembershipPort {
  const { registry, resolveEndpointSelfId } = options;

  const port: VenueMembershipPort = {
    resolveRoom(input: RoomClaimInput): ResolvedRoomInfo | undefined {
      const venue = registry.findByConversation(input);
      if (!venue) return undefined;
      const entryMember = registry.resolveEntryMember(venue.id) ?? resolveVenueEntryMember(venue);
      return Object.freeze({
        roomId: venue.id,
        defaultEndpointId: entryMember.botEndpoint,
        memberEndpoints: Object.freeze(venue.members.map((m) => m.botEndpoint)),
      });
    },

    isAddressedEndpoint(input: RoomArbitrationInput): boolean {
      const venue = registry.findByConversation(input);
      if (!venue) return false;
      const member = registry.resolveMemberByEndpoint(venue.id, input.endpointId);
      if (!member) return false;

      const selfId = resolveEndpointSelfId?.(venue.conversation.platform, member.botEndpoint);
      if (input.mentions && input.mentions.length > 0) {
        if (selfId !== undefined && selfId !== '' && input.mentions.includes(selfId)) {
          return true;
        }
        const lowerNames = new Set(
          [member.agent, ...(member.aliases ?? [])].map((name) => name.toLowerCase()),
        );
        if (input.mentions.some((target) => lowerNames.has(target.toLowerCase()))) {
          return true;
        }
      }

      if (input.rawText && findEarliestMemberTextMention(input.rawText, member) >= 0) {
        return true;
      }

      if (input.replyToSenderId !== undefined && input.replyToSenderId !== '') {
        if (selfId !== undefined && selfId !== '' && input.replyToSenderId === selfId) {
          return true;
        }
        if (input.replyToSenderId === member.botEndpoint) {
          return true;
        }
      }

      return false;
    },

    isRoomReady(input: RoomClaimInput): RoomReadinessResult {
      const venue = registry.findByConversation(input);
      if (!venue || !resolveEndpointSelfId) {
        return Object.freeze({ ready: true });
      }
      const unreadyEndpoints = findUnreadyVenueEndpoints(venue, resolveEndpointSelfId);
      if (unreadyEndpoints.length > 0) {
        return Object.freeze({ ready: false, unreadyEndpoints });
      }
      return Object.freeze({ ready: true });
    },

    isMember(peer, conversation): boolean {
      const venue = registry.findByConversation({
        platform: conversation.endpoint.adapter,
        sceneType: conversation.kind,
        sceneId: conversation.id,
        ...(conversation.threadId !== undefined ? { threadId: conversation.threadId } : {}),
      });
      if (!venue) return false;
      if (peer.endpointIds.some((endpointId) => registry.resolveMemberByEndpoint(venue.id, String(endpointId)) !== undefined)) {
        return true;
      }
      if (resolveEndpointSelfId && peer.userId !== '') {
        return venue.members.some(
          (m) => resolveEndpointSelfId(venue.conversation.platform, m.botEndpoint) === peer.userId,
        );
      }
      return false;
    },

    hasRoom(conversation): boolean {
      const venue = registry.findByConversation({
        platform: conversation.endpoint.adapter,
        sceneType: conversation.kind,
        sceneId: conversation.id,
        ...(conversation.threadId !== undefined ? { threadId: conversation.threadId } : {}),
      });
      return venue !== undefined && registry.resolveMemberByEndpoint(venue.id, String(conversation.endpoint.id)) !== undefined;
    },

    route(input: RoomInboundRouteInput): RoomRouteDecision | undefined {
      const venue = registry.findByConversation({
        platform: input.conversation.endpoint.adapter,
        sceneType: input.conversation.kind,
        sceneId: input.conversation.id,
        ...(input.conversation.threadId !== undefined ? { threadId: input.conversation.threadId } : {}),
      });
      if (!venue) return undefined;
      if (registry.resolveMemberByEndpoint(venue.id, String(input.conversation.endpoint.id)) === undefined) {
        return undefined;
      }

      const availableMembers = venue.members.filter((m) => input.isAvailable(m.botEndpoint));
      if (availableMembers.length === 0) return undefined;

      const pendingMember = availableMembers.find((m) => input.pending(m.botEndpoint));
      const replyToMember = input.replyToEndpointId
        ? availableMembers.find((m) => m.botEndpoint === input.replyToEndpointId)
        : undefined;
      const effectiveSelfId = (platform: string, endpointId: string) =>
        input.accountOf(endpointId) ?? resolveEndpointSelfId?.(platform, endpointId);
      const replyToSenderId = replyToMember
        ? effectiveSelfId(venue.conversation.platform, replyToMember.botEndpoint) ?? replyToMember.botEndpoint
        : undefined;

      const routed = routeVenueMessage({
        venue: { ...venue, members: availableMembers },
        text: input.content,
        mentions: input.mentionTargets,
        ...(replyToSenderId !== undefined ? { replyToSenderId } : {}),
        ...(pendingMember ? { pendingAgent: pendingMember.agent } : {}),
        resolveEndpointSelfId: effectiveSelfId,
      });

      const reasonMap: Record<typeof routed.reason, RoomRouteDecision['reason']> = {
        pending: 'pending',
        mention: 'mention',
        reply: 'reply',
        endpoint: 'role',
        entry: 'coordinator',
      };

      return Object.freeze({
        endpointId: routed.member.botEndpoint,
        reason: reasonMap[routed.reason],
        fallbackEndpointIds: Object.freeze(
          availableMembers
            .filter((m) => m.botEndpoint !== routed.member.botEndpoint)
            .map((m) => m.botEndpoint),
        ),
      });
    },
  };

  return Object.freeze(port);
}
