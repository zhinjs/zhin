import type { RoomTaskCommand } from './room-task.js';
import type { GuardActor, RoomGuards } from './room-guards.js';

/*
 * Synchronous `authorize` hook for createRoomTaskService({ authorize }).
 *
 * B4 only restricts `cancel`: it is a sensitive operation, so the issuer must resolve to a configured
 * human account. An agent member cannot cancel its own Task; it can only block or hand off.
 * Every other command is allowed here.
 *
 * Notes for C1 (not enforced here, by design):
 * - `authorize(roomId, command)` is synchronous and cannot see the Task's current state. C1 can therefore only
 *   restrict `assign` by role (coordinator/lead only), not by "already assigned". A same-person `assign` on a
 *   `blocked` Task counts as unblocking it.
 * - Subscribers of RoomTaskService are dispatched after the Room serial section, so concurrent executes on one
 *   Room may interleave their dispatches. Subscribers must order by `event.sequence`.
 * - Non-member accounts include other humans in the group: when a human mentions a human, the coordinator
 *   stays silent. That is router behavior, not a guard concern.
 */

export type RoomTaskAuthorizer = (roomId: string, command: RoomTaskCommand) => string | undefined;

export interface RoomTaskAuthorizerOptions {
  readonly guards: Pick<RoomGuards, 'authorizeSensitive'>;
  /** Resolves the `by` of a command to the actor behind it; undefined means unknown, which is refused. */
  readonly actorOf: (by: string) => GuardActor | undefined;
}

export function createRoomTaskAuthorizer(options: RoomTaskAuthorizerOptions): RoomTaskAuthorizer {
  const { guards, actorOf } = options;
  return (_roomId, command) => {
    if (command.type !== 'cancel') return undefined;
    try {
      const actor = actorOf(command.by);
      if (!actor) return 'task.cancel requires a known human actor';
      return guards.authorizeSensitive('task.cancel', actor);
    } catch (error) {
      return `task.cancel authorization failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
}
