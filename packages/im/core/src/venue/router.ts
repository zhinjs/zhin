import type { VenueDefinition, VenueMemberConfig } from './contracts.js';

export type VenueRouteReason = 'pending' | 'mention' | 'reply' | 'endpoint' | 'entry';

export interface RouteVenueMessageInput {
  readonly venue: VenueDefinition;
  readonly text: string;
  readonly mentions?: readonly string[];
  readonly replyToSenderId?: string;
  readonly pendingAgent?: string;
  readonly winningEndpointId?: string;
  readonly resolveEndpointSelfId?: (platform: string, endpointId: string) => string | undefined;
}

export interface VenueRouteResult {
  readonly member: VenueMemberConfig;
  readonly reason: VenueRouteReason;
}

const WORD_CHAR = '\\p{L}\\p{N}_-';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findMentionPositionInText(text: string, name: string): number {
  if (!text || !name) return -1;
  const pattern = new RegExp(`(?<![${WORD_CHAR}])@${escapeRegExp(name)}(?![${WORD_CHAR}])`, 'iu');
  const match = pattern.exec(text);
  return match ? match.index : -1;
}

export function findEarliestMemberTextMention(text: string, member: VenueMemberConfig): number {
  if (!text) return -1;
  const names = [member.agent, ...(member.aliases ?? [])];
  let earliest = -1;
  for (const name of names) {
    const pos = findMentionPositionInText(text, name);
    if (pos >= 0 && (earliest < 0 || pos < earliest)) {
      earliest = pos;
    }
  }
  return earliest;
}

export function resolveVenueEntryMember(venue: VenueDefinition): VenueMemberConfig {
  if (venue.entry !== undefined) {
    const found = venue.members.find((m) => m.agent === venue.entry);
    if (found) return found;
  }
  const first = venue.members[0];
  if (!first) {
    throw new Error(`Venue "${venue.id}" has no members`);
  }
  return first;
}

export function routeVenueMessage(input: RouteVenueMessageInput): VenueRouteResult {
  const { venue, text, mentions, replyToSenderId, pendingAgent, winningEndpointId, resolveEndpointSelfId } = input;
  const platform = venue.conversation.platform;
  const entryMember = resolveVenueEntryMember(venue);

  // 1. pending
  if (pendingAgent !== undefined && pendingAgent !== '') {
    const pendingMember = venue.members.find((m) => m.agent === pendingAgent);
    if (pendingMember) {
      return Object.freeze({ member: pendingMember, reason: 'pending' });
    }
  }

  // 2. mention (structured mentions first, then @<agent> / @<alias> in text)
  if (mentions && mentions.length > 0) {
    for (const target of mentions) {
      if (!target) continue;
      const bySelfId = venue.members.find((m) => {
        const selfId = resolveEndpointSelfId?.(platform, m.botEndpoint);
        return selfId !== undefined && selfId !== '' && selfId === target;
      });
      if (bySelfId) {
        return Object.freeze({ member: bySelfId, reason: 'mention' });
      }
      const lowerTarget = target.toLowerCase();
      const byName = venue.members.find(
        (m) =>
          m.agent.toLowerCase() === lowerTarget
          || (m.aliases?.some((alias) => alias.toLowerCase() === lowerTarget) ?? false),
      );
      if (byName) {
        return Object.freeze({ member: byName, reason: 'mention' });
      }
    }
  }

  if (text) {
    let bestMember: VenueMemberConfig | undefined;
    let bestIndex = -1;
    for (const member of venue.members) {
      const idx = findEarliestMemberTextMention(text, member);
      if (idx >= 0 && (bestIndex < 0 || idx < bestIndex)) {
        bestIndex = idx;
        bestMember = member;
      }
    }
    if (bestMember) {
      return Object.freeze({ member: bestMember, reason: 'mention' });
    }
  }

  // 3. reply
  if (replyToSenderId !== undefined && replyToSenderId !== '') {
    const repliedMember = venue.members.find((m) => {
      const selfId = resolveEndpointSelfId?.(platform, m.botEndpoint);
      return (selfId !== undefined && selfId !== '' && selfId === replyToSenderId) || m.botEndpoint === replyToSenderId;
    });
    if (repliedMember) {
      return Object.freeze({ member: repliedMember, reason: 'reply' });
    }
  }

  // 4. endpoint (non-entry winningEndpointId)
  if (winningEndpointId !== undefined && winningEndpointId !== '') {
    const endpointMember = venue.members.find((m) => m.botEndpoint === winningEndpointId);
    if (endpointMember && endpointMember.botEndpoint !== entryMember.botEndpoint) {
      return Object.freeze({ member: endpointMember, reason: 'endpoint' });
    }
  }

  // 5. entry
  return Object.freeze({ member: entryMember, reason: 'entry' });
}
