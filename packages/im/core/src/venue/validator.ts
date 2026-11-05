import type { VenueDefinition, VenueVisibilityMode } from './contracts.js';

const VALID_SCENE_TYPES = new Set(['private', 'group', 'channel']);
const VALID_VISIBILITY_MODES = new Set<VenueVisibilityMode>(['visible', 'summary', 'backstage']);

export class VenueValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid venue definitions:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'VenueValidationError';
    this.issues = Object.freeze([...issues]);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateVenueDefinitions(venues: readonly VenueDefinition[]): void {
  if (!Array.isArray(venues)) {
    throw new VenueValidationError(['venues must be an array']);
  }

  const issues: string[] = [];
  const seenVenueIds = new Set<string>();
  const seenConversations: Array<{
    readonly venueId: string;
    readonly platform: string;
    readonly sceneType: string | undefined;
    readonly sceneId: string;
    readonly threadId: string;
  }> = [];

  for (let i = 0; i < venues.length; i++) {
    const venue = venues[i];
    const label = isNonEmptyString(venue?.id) ? `venue "${venue.id.trim()}"` : `venues[${i}]`;

    if (!venue || typeof venue !== 'object') {
      issues.push(`${label}: must be an object`);
      continue;
    }

    if (!isNonEmptyString(venue.id)) {
      issues.push(`${label}: id must be a non-empty string`);
    } else {
      const id = venue.id.trim();
      if (seenVenueIds.has(id)) {
        issues.push(`${label}: duplicate venue id "${id}"`);
      } else {
        seenVenueIds.add(id);
      }
    }

    const conv = venue.conversation;
    if (!conv || typeof conv !== 'object') {
      issues.push(`${label}: conversation is required`);
    } else {
      const platformOk = isNonEmptyString(conv.platform);
      const sceneIdOk = isNonEmptyString(conv.sceneId);
      if (!platformOk) {
        issues.push(`${label}: conversation.platform must be a non-empty string`);
      }
      if (!sceneIdOk) {
        issues.push(`${label}: conversation.sceneId must be a non-empty string`);
      }
      if (conv.sceneType !== undefined && !VALID_SCENE_TYPES.has(conv.sceneType)) {
        issues.push(`${label}: conversation.sceneType must be one of "private", "group", "channel"`);
      }
      if (conv.threadId !== undefined && !isNonEmptyString(conv.threadId)) {
        issues.push(`${label}: conversation.threadId must be a non-empty string when provided`);
      }
      if (platformOk && sceneIdOk) {
        const platform = conv.platform.trim();
        const sceneType = conv.sceneType;
        const sceneId = conv.sceneId.trim();
        const threadId = conv.threadId?.trim() ?? '';
        const conflict = seenConversations.find(
          (existing) =>
            existing.platform === platform
            && existing.sceneId === sceneId
            && existing.threadId === threadId
            && (existing.sceneType === undefined || sceneType === undefined || existing.sceneType === sceneType),
        );
        if (conflict) {
          issues.push(
            `${label}: duplicate conversation (${platform}/${sceneType ?? '*'}/${sceneId}${threadId ? `/${threadId}` : ''}) already bound by venue "${conflict.venueId}"`,
          );
        } else {
          seenConversations.push({
            venueId: isNonEmptyString(venue.id) ? venue.id.trim() : `venues[${i}]`,
            platform,
            sceneType,
            sceneId,
            threadId,
          });
        }
      }
    }

    const memberAgents = new Set<string>();
    const memberEndpoints = new Set<string>();
    const memberNamesLower = new Set<string>();

    if (!Array.isArray(venue.members) || venue.members.length === 0) {
      issues.push(`${label}: members must be a non-empty array`);
    } else {
      for (let m = 0; m < venue.members.length; m++) {
        const member = venue.members[m];
        const memberLabel = `${label}.members[${m}]`;
        if (!member || typeof member !== 'object') {
          issues.push(`${memberLabel}: must be an object`);
          continue;
        }
        if (!isNonEmptyString(member.agent)) {
          issues.push(`${memberLabel}: agent must be a non-empty string`);
        } else {
          const agent = member.agent.trim();
          if (memberAgents.has(agent)) {
            issues.push(`${memberLabel}: duplicate member agent "${agent}" in venue`);
          } else {
            memberAgents.add(agent);
            memberNamesLower.add(agent.toLowerCase());
          }
        }

        if (!isNonEmptyString(member.botEndpoint)) {
          issues.push(`${memberLabel}: botEndpoint must be a non-empty string`);
        } else {
          const endpoint = member.botEndpoint.trim();
          if (memberEndpoints.has(endpoint)) {
            issues.push(`${memberLabel}: duplicate member botEndpoint "${endpoint}" in venue`);
          } else {
            memberEndpoints.add(endpoint);
          }
        }

        if (member.aliases !== undefined) {
          if (!Array.isArray(member.aliases)) {
            issues.push(`${memberLabel}: aliases must be an array of strings`);
          } else {
            for (let a = 0; a < member.aliases.length; a++) {
              const alias = member.aliases[a];
              if (!isNonEmptyString(alias)) {
                issues.push(`${memberLabel}.aliases[${a}]: alias must be a non-empty string`);
              } else {
                const lower = alias.trim().toLowerCase();
                if (memberNamesLower.has(lower)) {
                  issues.push(`${memberLabel}.aliases[${a}]: duplicate alias "${alias}" in venue`);
                } else {
                  memberNamesLower.add(lower);
                }
              }
            }
          }
        }
      }
    }

    if (venue.entry !== undefined) {
      if (!isNonEmptyString(venue.entry)) {
        issues.push(`${label}: entry must be a non-empty string when specified`);
      } else if (memberAgents.size > 0 && !memberAgents.has(venue.entry.trim())) {
        issues.push(`${label}: entry "${venue.entry}" does not match any member agent in venue`);
      }
    }

    if (venue.visibility !== undefined && !VALID_VISIBILITY_MODES.has(venue.visibility)) {
      issues.push(`${label}: visibility must be "visible", "summary", or "backstage"`);
    }
  }

  if (issues.length > 0) {
    throw new VenueValidationError(issues);
  }
}
