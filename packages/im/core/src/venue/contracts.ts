export type VenueVisibilityMode = 'visible' | 'summary' | 'backstage';

export interface VenueConversationConfig {
  readonly platform: string;
  readonly sceneType?: 'private' | 'group' | 'channel';
  readonly sceneId: string;
  readonly threadId?: string;
}

export interface VenueMemberConfig {
  readonly agent: string;
  readonly botEndpoint: string;
  readonly aliases?: readonly string[];
}

export interface VenueDefinition {
  readonly id: string;
  readonly label?: string;
  readonly conversation: VenueConversationConfig;
  readonly members: readonly VenueMemberConfig[];
  readonly entry?: string;
  readonly visibility?: VenueVisibilityMode;
}

export function resolveVenueVisibility(venue: VenueDefinition): VenueVisibilityMode {
  return venue.visibility ?? (venue.conversation.sceneType === 'private' ? 'backstage' : 'visible');
}
