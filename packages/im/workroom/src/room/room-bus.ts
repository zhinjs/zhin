import type { PluginId } from '@zhin.js/plugin-runtime';
import type { OutboundMessageService } from '@zhin.js/core/runtime';
import type { RoomRegistry } from './room-registry.js';

/**
 * Minimal handoff event. Task state (accepted / done / ...) belongs to the Task state machine
 * (B3) and is intentionally absent here.
 */
export interface RoomHandoffEvent {
  readonly id: string;
  readonly room: string;
  /** Agent name of the handing-off member. */
  readonly from: string;
  /** Agent name of the receiving member. */
  readonly to: string;
  readonly text: string;
  readonly taskRef?: string;
  /** Epoch milliseconds. */
  readonly at: number;
}

export interface RoomHandoffResult {
  /** At least one subscriber accepted the event. */
  readonly delivered: boolean;
  /** The group-visible projection was sent through the normal send chain. */
  readonly projected: boolean;
  readonly projectionError?: string;
  /** Set when validation refused the handoff; nothing was projected or delivered. */
  readonly rejection?: string;
}

export interface RoomBus {
  handoff(event: RoomHandoffEvent): Promise<RoomHandoffResult>;
  subscribe(listener: (event: RoomHandoffEvent) => void | Promise<void>): () => void;
}

export interface RoomBusOptions {
  readonly registry: RoomRegistry;
  /** The only way the Bus talks to the group: the normal outbound chain. */
  readonly outbound: Pick<OutboundMessageService, 'send'>;
  readonly requester: PluginId;
  /** Bot account (user id) of a runtime Endpoint, e.g. PeerRegistry.selfOf. */
  readonly accountOf: (endpointId: string) => string | undefined;
  readonly logger?: { warn(message: string): void };
}

export function createRoomBus(options: RoomBusOptions): RoomBus {
  const { registry, outbound, requester, accountOf, logger } = options;
  const listeners = new Set<(event: RoomHandoffEvent) => void | Promise<void>>();

  const reject = (rejection: string): RoomHandoffResult => ({ delivered: false, projected: false, rejection });

  return Object.freeze({
    subscribe(listener: (event: RoomHandoffEvent) => void | Promise<void>) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    async handoff(event: RoomHandoffEvent): Promise<RoomHandoffResult> {
      if (typeof event.id !== 'string' || event.id === '') return reject('handoff id must not be empty');
      const room = registry.room(event.room);
      if (!room) return reject(`unknown room "${event.room}"`);
      const from = room.memberByAgent(event.from);
      if (!from) return reject(`"${event.from}" is not a member of room ${room.id}`);
      const to = room.memberByAgent(event.to);
      if (!to) return reject(`"${event.to}" is not a member of room ${room.id}`);
      if (from === to) return reject('a member cannot hand off to itself');
      if (!from.role.handoffTo?.includes(to.roleName)) {
        return reject(`role "${from.roleName}" may not hand off to role "${to.roleName}"`);
      }

      // Group-visible projection first, through the normal send chain only
      // (OutboundMessageService.send -> OutboundRenderer -> outbound middleware -> Endpoint).
      let projected = false;
      let projectionError: string | undefined;
      try {
        const { adapter, kind, id } = room.definition.conversation;
        const account = accountOf(to.endpointId);
        const receipt = await outbound.send({
          conversation: { endpoint: { id: from.endpointId, adapter }, kind, id },
          requester,
          content: account !== undefined
            ? [
                { type: 'mention', data: { target: account, name: to.agent } },
                { type: 'text', data: { text: ` ${event.text}` } },
              ]
            : `@${to.agent} ${event.text}`,
        });
        projected = receipt.status === 'sent';
        if (!projected) projectionError = receipt.failure?.code ?? receipt.status;
      } catch (error) {
        projectionError = error instanceof Error ? error.message : String(error);
      }
      if (projectionError !== undefined) {
        // Never swallow the event: the caller learns the projection failed and subscribers still wake.
        logger?.warn(`room ${room.id} handoff ${event.id} projection failed: ${projectionError}`);
      }

      let accepted = 0;
      const results = await Promise.allSettled([...listeners].map(async (listener) => listener(event)));
      for (const result of results) {
        if (result.status === 'fulfilled') accepted++;
        else logger?.warn(`room ${room.id} handoff ${event.id} subscriber failed: ${
          result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      }

      return {
        delivered: accepted > 0,
        projected,
        ...(projectionError !== undefined ? { projectionError } : {}),
      };
    },
  });
}
