import type { RoomTaskCommand } from './room-task.js';
import type { GuardActor, RoomGuards } from './room-guards.js';

/*
 * Synchronous `authorize` hook for createRoomTaskService({ authorize }).
 *
 * This is a PARTIAL check, fail-closed for the two commands it covers:
 * - `cancel` is sensitive: the issuer must resolve to a configured human account (via actorOf). An agent
 *   member cannot cancel its own Task; it can only block or hand off.
 * - `assign` is refused unless a role check (`authorizeAssign`, lead / coordinator only) is supplied and
 *   allows it. `assign` is the only command that skips the handoff depth / ping-pong limits (it checks
 *   neither `from` nor handoffCount), so letting anyone re-assign would bypass them. The hook is synchronous
 *   and cannot see the Task's state, so without `authorizeAssign` every `assign` is refused; the first
 *   assignment goes through `create` with an assignee and is not affected.
 *
 * Every other command is passed on to `next` (or allowed when `next` is absent). Membership and `handoffTo`
 * checks are NOT done here: C1 supplies them via `next`. C1 may later give `authorize` a Task view
 * (an overload) to restrict only assigned / blocked Tasks; that is a C1 option, not part of B4.
 *
 * Notes for C1:
 * - A same-person `assign` on a `blocked` Task counts as unblocking it.
 * - Subscribers of RoomTaskService are dispatched after the Room serial section, so concurrent executes on one
 *   Room may interleave their dispatches. Subscribers must order by `event.sequence`.
 * - Non-member accounts include other humans in the group: when a human mentions a human, the coordinator
 *   stays silent. That is router behavior, not a guard concern.
 */

export type RoomTaskAuthorizer = (roomId: string, command: RoomTaskCommand) => string | undefined;

export type RoomAssignCommand = Extract<RoomTaskCommand, { type: 'assign' }>;

export interface RoomTaskAuthorizerOptions {
  readonly guards: Pick<RoomGuards, 'authorizeSensitive'>;
  /** Resolves the `by` of a command to the actor behind it; undefined means unknown, which is refused. */
  readonly actorOf: (by: string) => GuardActor | undefined;
  /**
   * Role check for `assign` (lead / coordinator only); return a refusal reason or undefined to allow.
   * Optional, but when absent every `assign` is refused (fail-closed).
   */
  readonly authorizeAssign?: (roomId: string, command: RoomAssignCommand) => string | undefined;
  /** Composed after the built-in checks pass (membership, handoffTo, ...). */
  readonly next?: RoomTaskAuthorizer;
}

export function createRoomTaskAuthorizer(options: RoomTaskAuthorizerOptions): RoomTaskAuthorizer {
  const { guards, actorOf, authorizeAssign, next } = options;
  return (roomId, command) => {
    if (command.type === 'cancel') {
      try {
        const actor = actorOf(command.by);
        if (!actor) return 'task.cancel requires a known human actor';
        const refusal = guards.authorizeSensitive('task.cancel', actor);
        if (refusal !== undefined) return refusal;
      } catch (error) {
        return `task.cancel authorization failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    } else if (command.type === 'assign') {
      if (!authorizeAssign) return 'task.assign requires a role check (authorizeAssign); refused by default';
      try {
        const refusal = authorizeAssign(roomId, command);
        if (refusal !== undefined) return refusal;
      } catch (error) {
        return `task.assign authorization failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    try {
      return next?.(roomId, command);
    } catch (error) {
      return `task authorization failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
}
