import type { VenueDefinition, VenueMemberConfig } from './contracts.js';
import { validateVenueDefinitions } from './validator.js';

export interface VenueConversationLookup {
  readonly platform: string;
  readonly sceneType?: string;
  readonly sceneId: string;
  readonly threadId?: string;
}

export interface VenueRegistry {
  list(): readonly VenueDefinition[];
  get(venueId: string): VenueDefinition | undefined;
  findByConversation(conv: VenueConversationLookup): VenueDefinition | undefined;
  resolveMemberByAgent(venueId: string, agent: string): VenueMemberConfig | undefined;
  resolveMemberByEndpoint(venueId: string, endpointId: string): VenueMemberConfig | undefined;
  resolveEntryMember(venueId: string): VenueMemberConfig | undefined;
}

export function createVenueRegistry(venues: readonly VenueDefinition[]): VenueRegistry {
  validateVenueDefinitions(venues);

  const frozenVenues: readonly VenueDefinition[] = Object.freeze(
    venues.map((venue) =>
      Object.freeze({
        ...venue,
        conversation: Object.freeze({ ...venue.conversation }),
        members: Object.freeze(
          venue.members.map((member) =>
            Object.freeze({
              ...member,
              ...(member.aliases ? { aliases: Object.freeze([...member.aliases]) } : {}),
            }),
          ),
        ),
      }),
    ),
  );

  const byId = new Map<string, VenueDefinition>();
  const byAgent = new Map<string, Map<string, VenueMemberConfig>>();
  const byEndpoint = new Map<string, Map<string, VenueMemberConfig>>();

  for (const venue of frozenVenues) {
    byId.set(venue.id, venue);
    const agentMap = new Map<string, VenueMemberConfig>();
    const endpointMap = new Map<string, VenueMemberConfig>();
    for (const member of venue.members) {
      agentMap.set(member.agent, member);
      endpointMap.set(member.botEndpoint, member);
    }
    byAgent.set(venue.id, agentMap);
    byEndpoint.set(venue.id, endpointMap);
  }

  return Object.freeze({
    list(): readonly VenueDefinition[] {
      return frozenVenues;
    },

    get(venueId: string): VenueDefinition | undefined {
      return byId.get(venueId);
    },

    findByConversation(conv: VenueConversationLookup): VenueDefinition | undefined {
      const targetThread = conv.threadId ?? '';
      return frozenVenues.find((venue) => {
        const c = venue.conversation;
        if (c.platform !== conv.platform || c.sceneId !== conv.sceneId) {
          return false;
        }
        if (c.sceneType !== undefined && conv.sceneType !== undefined && c.sceneType !== conv.sceneType) {
          return false;
        }
        const venueThread = c.threadId ?? '';
        return venueThread === targetThread;
      });
    },

    resolveMemberByAgent(venueId: string, agent: string): VenueMemberConfig | undefined {
      return byAgent.get(venueId)?.get(agent);
    },

    resolveMemberByEndpoint(venueId: string, endpointId: string): VenueMemberConfig | undefined {
      return byEndpoint.get(venueId)?.get(endpointId);
    },

    resolveEntryMember(venueId: string): VenueMemberConfig | undefined {
      const venue = byId.get(venueId);
      if (!venue || venue.members.length === 0) return undefined;
      if (venue.entry !== undefined) {
        return byAgent.get(venueId)?.get(venue.entry) ?? venue.members[0];
      }
      return venue.members[0];
    },
  });
}
