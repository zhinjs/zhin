import { resolveVenueVisibility, type VenueConversationConfig } from './contracts.js';
import { createVenueFloorController, type VenueFloorController } from './floor-controller.js';
import type { VenueRegistry } from './registry.js';
import type { VenueSendLimiter } from './send-limiter.js';

export interface VenueProjectionHopInput {
  readonly venueId: string;
  readonly mailId: string;
  readonly kind: 'ask' | 'delegate' | 'tell' | 'result';
  readonly fromAgent: string;
  readonly toAgent?: string;
  readonly content: string;
  readonly isStart?: boolean;
  readonly isConclusion?: boolean;
}

export interface VenueProjectionSendInput {
  readonly venueId: string;
  readonly endpointId: string;
  readonly actor: string;
  readonly conversation: VenueConversationConfig;
  readonly text: string;
}

export interface VenueProjectedEvent {
  readonly venueId: string;
  readonly actor: string;
  readonly mailId: string;
  readonly mode: 'visible' | 'summary';
}

export interface CreateVenueProjectorOptions {
  readonly registry: VenueRegistry;
  readonly floor?: VenueFloorController;
  readonly limiter?: VenueSendLimiter;
  readonly send: (input: VenueProjectionSendInput) => Promise<void>;
  readonly onProjected?: (event: VenueProjectedEvent) => void | Promise<void>;
}

export interface VenueProjector {
  projectHop(input: VenueProjectionHopInput): Promise<boolean>;
}

export function createVenueProjector(options: CreateVenueProjectorOptions): VenueProjector {
  const { registry, send, onProjected, limiter } = options;
  const floor = options.floor ?? createVenueFloorController();

  return Object.freeze({
    async projectHop(input: VenueProjectionHopInput): Promise<boolean> {
      const venue = registry.get(input.venueId);
      if (!venue) return false;

      const mode = resolveVenueVisibility(venue);
      if (mode === 'backstage') return false;
      if (mode === 'summary' && !input.isStart && !input.isConclusion) {
        return false;
      }

      const speaker =
        registry.resolveMemberByAgent(venue.id, input.fromAgent) ?? registry.resolveEntryMember(venue.id);
      if (!speaker) return false;

      const target = input.toAgent ? registry.resolveMemberByAgent(venue.id, input.toAgent) : undefined;
      const text =
        target && input.kind !== 'tell'
          ? `@${target.aliases?.[0] ?? target.agent} ${input.content}`
          : input.content;

      await floor.withFloor(venue.id, speaker.agent, async () => {
        if (limiter) {
          await limiter.acquire({ venueId: venue.id, endpointId: speaker.botEndpoint });
        }
        await send({
          venueId: venue.id,
          endpointId: speaker.botEndpoint,
          actor: speaker.agent,
          conversation: venue.conversation,
          text,
        });
      });

      await onProjected?.({
        venueId: venue.id,
        actor: speaker.agent,
        mailId: input.mailId,
        mode,
      });

      return true;
    },
  });
}
