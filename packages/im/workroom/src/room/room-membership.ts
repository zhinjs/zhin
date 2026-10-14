import type { RoomMembershipPort } from '@zhin.js/core/runtime';
import type { RoomRegistry } from './room-registry.js';
import { routeRoomMessage } from './room-router.js';

/**
 * The single factory for core's `RoomMembershipPort`. `hasRoom` and `route` are always provided
 * together: core only dedups Room conversations when `hasRoom` is true, and without `route` the
 * Endpoint that loses the dedup would never get its @ / reply / pending interaction resolved.
 * Do not expose `hasRoom` on its own.
 */
export function createRoomMembershipPort(registry: RoomRegistry): RoomMembershipPort {
  const port: RoomMembershipPort = {
    isMember(peer, conversation) {
      const room = registry.roomOf(conversation);
      if (!room) return false;
      return peer.endpointIds.some((endpointId) => room.memberByEndpoint(String(endpointId)) !== undefined);
    },
    hasRoom(conversation) {
      return registry.roomOf(conversation) !== undefined;
    },
    route(input) {
      const room = registry.roomOf(input.conversation);
      return room ? routeRoomMessage(room, input) : undefined;
    },
  };
  return Object.freeze(port);
}
