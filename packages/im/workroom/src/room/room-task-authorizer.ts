import type { RoomTaskCommand } from './room-task.js';
import type { GuardActor, RoomGuards } from './room-guards.js';
import type { RoomDefinition } from './room-definition.js';
import type { RoomEntry } from './room-registry.js';

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
 * Every other command is passed on to `next`. `next` should be `createRoomRoleAuthorizer` (role / membership
 * check for create / start / block / complete / handoff, including `handoffTo`), and `authorizeAssign` should be
 * `createRoomRoleAssignAuthorizer`. Without `next`, start / block / handoff are NOT checked by this authorizer
 * (they pass through unchecked), so that is not a safe default. C1 may later give `authorize` a Task view
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
  /**
   * Composed after the built-in checks pass. Use `createRoomRoleAuthorizer(...)` to enforce the role /
   * membership checks for create / start / block / complete / handoff (and `handoffTo`); when absent those
   * commands are not checked here (not a safe default).
   */
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

// ---------------------------------------------------------------- role-based helpers

export interface RoomRoleAuthorizerOptions {
  /** The Room definition (preferred) or a registry entry; membership is indexed from it. */
  readonly room: RoomDefinition | RoomEntry;
  /** When given, commands for any other room id are refused (`unknown room`). */
  readonly roomId?: string;
  /**
   * Resolves `by` to an actor; used only for `create`, where a human may start a Task. Without it, a `by` with
   * the `human:` prefix counts as a human and every other `by` must be a member.
   */
  readonly actorOf?: (by: string) => GuardActor | undefined;
}

interface RoleIndex {
  readonly id: string | undefined;
  readonly coordinator: string | undefined;
  readonly roleOf: (agent: string) => string | undefined;
  readonly handoffTo: (agent: string) => readonly string[] | undefined;
}

function indexRoom(room: RoomDefinition | RoomEntry): RoleIndex {
  const entry = 'definition' in room ? room : undefined;
  const definition = entry ? entry.definition : (room as RoomDefinition);
  const byAgent = new Map<string, string>();
  for (const member of definition.members) byAgent.set(member.agent, member.role);
  return {
    id: entry?.id,
    coordinator: definition.coordinator,
    roleOf: (agent) => (Object.hasOwn(definition.roles, byAgent.get(agent) ?? '') ? byAgent.get(agent) : undefined),
    handoffTo: (agent) => {
      const role = byAgent.get(agent);
      return role !== undefined && Object.hasOwn(definition.roles, role) ? definition.roles[role]?.handoffTo : undefined;
    },
  };
}

const isHumanBy = (by: string): boolean => by.startsWith('human:') && by.length > 'human:'.length;

/**
 * Role / membership check to pass as `next` of `createRoomTaskAuthorizer`. Returns a refusal reason or undefined.
 * - create: `assignee` (if any) must be a member; `by` must be a known actor (a member or a human).
 * - start / block / complete: `by` must be a member.
 * - handoff: `by` and `to` are members and the role of `by` lists the role of `to` in `handoffTo`
 *   (no `handoffTo` means no handoff allowed).
 * - assign / cancel: not checked here (see `createRoomRoleAssignAuthorizer` and the built-in cancel check).
 * - any other (unknown) command type is refused.
 * Fail-closed: any throw (or a member whose role is missing) is a refusal.
 */
export function createRoomRoleAuthorizer(options: RoomRoleAuthorizerOptions): RoomTaskAuthorizer {
  const { room, roomId, actorOf } = options;
  return (target, command) => {
    try {
      const index = indexRoom(room);
      if (roomId !== undefined && target !== roomId) return `unknown room ${target}`;
      if (roomId === undefined && index.id !== undefined && target !== index.id) return `unknown room ${target}`;
      const member = (agent: string): boolean => index.roleOf(agent) !== undefined;
      switch (command.type) {
        case 'create': {
          const known = actorOf ? actorOf(command.by) !== undefined : isHumanBy(command.by) || member(command.by);
          if (!known) return `create: unknown actor ${command.by}`;
          if (command.assignee !== undefined && !member(command.assignee)) return `create: ${command.assignee} is not a member`;
          return undefined;
        }
        case 'start':
        case 'block':
        case 'complete':
          return member(command.by) ? undefined : `${command.type}: ${command.by} is not a member of room ${target}`;
        case 'handoff': {
          const from = index.roleOf(command.by);
          if (from === undefined) return `handoff: ${command.by} is not a member of room ${target}`;
          const to = index.roleOf(command.to);
          if (to === undefined) return `handoff: ${command.to} is not a member of room ${target}`;
          if (!index.handoffTo(command.by)?.includes(to)) return `handoff: role ${from} may not hand off to role ${to}`;
          return undefined;
        }
        case 'assign':
        case 'cancel':
          return undefined; // checked by `authorizeAssign` / the built-in cancel check
        default: {
          const unknown: never = command;
          return `unsupported command type ${String((unknown as { type?: unknown }).type)}`;
        }
      }
    } catch (error) {
      return `task authorization failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
}

/**
 * Role check for `assign`, to pass as `authorizeAssign`: only the coordinator (a Room without one refuses every
 * assign) may assign, and only to a member. The hook is synchronous and cannot see the Task, so status-dependent
 * rules stay with the state machine. Fail-closed: a throw is a refusal.
 */
export function createRoomRoleAssignAuthorizer(
  options: Pick<RoomRoleAuthorizerOptions, 'room' | 'roomId'>,
): (roomId: string, command: RoomAssignCommand) => string | undefined {
  const { room, roomId } = options;
  return (target, command) => {
    try {
      const index = indexRoom(room);
      if (roomId !== undefined && target !== roomId) return `unknown room ${target}`;
      if (roomId === undefined && index.id !== undefined && target !== index.id) return `unknown room ${target}`;
      if (index.roleOf(command.by) === undefined) return `assign: ${command.by} is not a member of room ${target}`;
      if (index.coordinator === undefined || command.by !== index.coordinator) return 'assign: only the coordinator may assign';
      if (index.roleOf(command.assignee) === undefined) return `assign: ${command.assignee} is not a member`;
      return undefined;
    } catch (error) {
      return `task authorization failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
}
