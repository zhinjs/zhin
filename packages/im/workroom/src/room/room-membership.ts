import type { RoomMembershipPort } from '@zhin.js/core/runtime';
import type { RoomRegistry } from './room-registry.js';
import { routeRoomMessage } from './room-router.js';

/**
 * The single factory for core's `RoomMembershipPort`. `hasRoom` and `route` are always provided
 * together: core only dedups Room conversations when `hasRoom` is true, and without `route` the
 * Endpoint that loses the dedup would never get its @ / reply / pending interaction resolved.
 * Do not expose `hasRoom` on its own.
 *
 * `hasRoom` is decided per (conversation, receiving Endpoint): it is true only when the Endpoint
 * that received the copy is a member of the Room bound to the conversation. A non-member Bot in
 * the same group is treated as being in an ordinary group (it handles its own copy, no claim /
 * arbitrate / forced mention). `route` applies the same membership check as a second guard.
 */
export function createRoomMembershipPort(registry: RoomRegistry): RoomMembershipPort {
  const port: RoomMembershipPort = {
    isMember(peer, conversation) {
      const room = registry.roomOf(conversation);
      if (!room) return false;
      return peer.endpointIds.some((endpointId) => room.memberByEndpoint(String(endpointId)) !== undefined);
    },
    hasRoom(conversation) {
      const room = registry.roomOf(conversation);
      return room !== undefined && room.memberByEndpoint(String(conversation.endpoint.id)) !== undefined;
    },
    route(input) {
      const room = registry.roomOf(input.conversation);
      if (!room || room.memberByEndpoint(String(input.conversation.endpoint.id)) === undefined) return undefined;
      return routeRoomMessage(room, input);
    },
  };
  return Object.freeze(port);
}
