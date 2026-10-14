import { digestCanonicalWorkroomValue } from '../workroom/canonical-value.js';
import { ROOM_RESERVED_NAMES } from './room-definition.js';

/**
 * Room Task: a small, replayable event-sourced state machine.
 *
 * Pure layer: no IO, no clock, no randomness (event ids are injected through `newId`, timestamps come
 * from the command). Authorization (is the actor a Room member, may the role hand off to that role)
 * is the caller's job; the machine only enforces the transition table and "only the current assignee
 * may start / block / complete / handoff".
 *
 * Handoff semantics: `task.handoff` changes the assignee to `to` and moves the Task back to `assigned`
 * (a task that was `in_progress` must be started again by the new assignee).
 */

export type RoomTaskStatus = 'created' | 'assigned' | 'in_progress' | 'done' | 'blocked' | 'cancelled';

export const ROOM_TASK_STATUSES: readonly RoomTaskStatus[] = Object.freeze([
  'created', 'assigned', 'in_progress', 'done', 'blocked', 'cancelled',
]);

/** Terminal statuses: no further event is accepted. */
export const ROOM_TASK_TERMINAL: readonly RoomTaskStatus[] = Object.freeze(['done', 'cancelled']);

export const ROOM_TASK_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/;
export const ROOM_TASK_RESULT_MAX_LENGTH = 8000;
const ACTOR_MAX = 128;
const TITLE_MAX = 200;
const TEXT_MAX = 2000;
const DESCRIPTION_MAX = 4000;

export type RoomTaskErrorCode =
  | 'invalid_input'
  | 'task_exists'
  | 'task_not_found'
  | 'task_terminal'
  | 'invalid_transition'
  | 'not_assignee';

export class RoomTaskTransitionError extends Error {
  constructor(readonly code: RoomTaskErrorCode, message: string) {
    super(message);
    this.name = 'RoomTaskTransitionError';
  }
}

export class RoomTaskCommandConflictError extends Error {
  constructor(readonly commandId: string) {
    super(`Room Task command ${commandId} was already used with different content`);
    this.name = 'RoomTaskCommandConflictError';
  }
}

export class RoomTaskReplayError extends Error {
  constructor(message: string) {
    super(`Room Task replay failed closed: ${message}`);
    this.name = 'RoomTaskReplayError';
  }
}

interface RoomTaskEventBase {
  readonly version: 1;
  readonly roomId: string;
  /** Contiguous from 0 per Room. */
  readonly sequence: number;
  readonly eventId: string;
  /** Epoch milliseconds, supplied by the caller. */
  readonly at: number;
  readonly taskId: string;
  readonly commandId: string;
  readonly commandDigest: string;
}

export type RoomTaskEvent = RoomTaskEventBase & (
  | { readonly type: 'task.created'; readonly title: string; readonly description?: string; readonly createdBy: string }
  | { readonly type: 'task.assigned'; readonly assignee: string; readonly by: string }
  | { readonly type: 'task.started'; readonly by: string }
  | { readonly type: 'task.blocked'; readonly by: string; readonly reason: string }
  | { readonly type: 'task.completed'; readonly by: string; readonly result: string }
  | { readonly type: 'task.cancelled'; readonly by: string; readonly reason?: string }
  | { readonly type: 'task.handoff'; readonly from: string; readonly to: string; readonly note?: string }
);

interface RoomTaskCommandBase {
  /** Idempotency key. */
  readonly commandId: string;
  readonly taskId: string;
  readonly by: string;
  /** Epoch milliseconds. */
  readonly at: number;
}

export type RoomTaskCommand = RoomTaskCommandBase & (
  | { readonly type: 'create'; readonly title: string; readonly description?: string; readonly assignee?: string }
  | { readonly type: 'assign'; readonly assignee: string }
  | { readonly type: 'start' }
  | { readonly type: 'block'; readonly reason: string }
  | { readonly type: 'complete'; readonly result: string }
  | { readonly type: 'cancel'; readonly reason?: string }
  | { readonly type: 'handoff'; readonly to: string; readonly note?: string }
);

export interface RoomTaskView {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly status: RoomTaskStatus;
  readonly assignee?: string;
  readonly createdBy: string;
  readonly result?: string;
  readonly blockedReason?: string;
  readonly handoffCount: number;
}

export interface RoomTaskState {
  readonly roomId: string;
  /** Sequence of the last applied event; -1 when the stream is empty. */
  readonly sequence: number;
  readonly tasks: Readonly<Record<string, RoomTaskView>>;
}

type MutableView = { -readonly [K in keyof RoomTaskView]: RoomTaskView[K] };
type MutableTasks = Record<string, MutableView>;

export function emptyRoomTaskState(roomId: string): RoomTaskState {
  return Object.freeze({ roomId, sequence: -1, tasks: Object.freeze(Object.create(null)) as Record<string, RoomTaskView> });
}

export function isRoomTaskTerminal(status: RoomTaskStatus): boolean {
  return ROOM_TASK_TERMINAL.includes(status);
}

export function findRoomTask(state: RoomTaskState, taskId: string): RoomTaskView | undefined {
  return Object.hasOwn(state.tasks, taskId) ? state.tasks[taskId] : undefined;
}

// ---------------------------------------------------------------- validation helpers

const fail = (code: RoomTaskErrorCode, message: string): never => {
  throw new RoomTaskTransitionError(code, message);
};

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max) {
    return fail('invalid_input', `${label} must be a non-empty trimmed string of at most ${max} characters`);
  }
  return value;
}

function optionalText(value: unknown, label: string, max: number): string | undefined {
  return value === undefined ? undefined : text(value, label, max);
}

function taskIdOf(value: unknown): string {
  if (typeof value !== 'string' || ROOM_RESERVED_NAMES.includes(value) || !ROOM_TASK_ID_PATTERN.test(value)) {
    return fail('invalid_input', `taskId ${JSON.stringify(value)} is invalid`);
  }
  return value;
}

function timestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return fail('invalid_input', 'at must be a non-negative integer');
  return value as number;
}

// ---------------------------------------------------------------- evolve (single source of transition rules)

/** Validates the event against the transition table and mutates `tasks`. Throws RoomTaskTransitionError. */
function step(tasks: MutableTasks, event: RoomTaskEvent): void {
  const taskId = taskIdOf(event.taskId);
  const existing = Object.hasOwn(tasks, taskId) ? tasks[taskId] : undefined;
  if (event.type === 'task.created') {
    if (existing) fail('task_exists', `task ${taskId} already exists`);
    const view: MutableView = {
      id: taskId,
      title: text(event.title, 'title', TITLE_MAX),
      status: 'created',
      createdBy: text(event.createdBy, 'createdBy', ACTOR_MAX),
      handoffCount: 0,
    };
    const description = optionalText(event.description, 'description', DESCRIPTION_MAX);
    if (description !== undefined) view.description = description;
    tasks[taskId] = view;
    return;
  }
  if (!existing) return fail('task_not_found', `task ${taskId} does not exist`);
  if (isRoomTaskTerminal(existing.status)) fail('task_terminal', `task ${taskId} is ${existing.status}`);
  const requireAssignee = (by: unknown): string => {
    const actor = text(by, 'actor', ACTOR_MAX);
    if (actor !== existing.assignee) fail('not_assignee', `${actor} is not the assignee of task ${taskId}`);
    return actor;
  };
  const requireStatus = (...allowed: RoomTaskStatus[]): void => {
    if (!allowed.includes(existing.status)) {
      fail('invalid_transition', `${event.type} is not allowed while task ${taskId} is ${existing.status}`);
    }
  };
  switch (event.type) {
    case 'task.assigned':
      requireStatus('created', 'assigned', 'blocked');
      text(event.by, 'by', ACTOR_MAX);
      existing.assignee = text(event.assignee, 'assignee', ACTOR_MAX);
      existing.status = 'assigned';
      delete existing.blockedReason;
      return;
    case 'task.started':
      requireStatus('assigned', 'blocked');
      requireAssignee(event.by);
      existing.status = 'in_progress';
      delete existing.blockedReason;
      return;
    case 'task.blocked':
      requireStatus('in_progress');
      requireAssignee(event.by);
      existing.blockedReason = text(event.reason, 'reason', TEXT_MAX);
      existing.status = 'blocked';
      return;
    case 'task.completed':
      requireStatus('in_progress');
      requireAssignee(event.by);
      existing.result = text(event.result, 'result', ROOM_TASK_RESULT_MAX_LENGTH);
      existing.status = 'done';
      return;
    case 'task.cancelled':
      text(event.by, 'by', ACTOR_MAX);
      optionalText(event.reason, 'reason', TEXT_MAX);
      existing.status = 'cancelled';
      return;
    case 'task.handoff': {
      requireStatus('assigned', 'in_progress', 'blocked');
      requireAssignee(event.from);
      const to = text(event.to, 'to', ACTOR_MAX);
      if (to === event.from) fail('invalid_input', 'cannot hand off a task to its current assignee');
      optionalText(event.note, 'note', TEXT_MAX);
      existing.assignee = to;
      existing.status = 'assigned';
      existing.handoffCount += 1;
      delete existing.blockedReason;
      return;
    }
    default:
      return fail('invalid_input', `unknown event type ${String((event as { type?: unknown }).type)}`);
  }
}

function freezeTasks(tasks: MutableTasks): Readonly<Record<string, RoomTaskView>> {
  for (const view of Object.values(tasks)) Object.freeze(view);
  return Object.freeze(tasks);
}

function cloneTasks(tasks: Readonly<Record<string, RoomTaskView>>): MutableTasks {
  const copy = Object.create(null) as MutableTasks;
  for (const [id, view] of Object.entries(tasks)) copy[id] = { ...view };
  return copy;
}

/** Applies one event to an immutable state. Re-validates the transition (never trusts the event). */
export function evolveRoomTasks(state: RoomTaskState, event: RoomTaskEvent): RoomTaskState {
  if (event.roomId !== state.roomId) fail('invalid_input', 'event roomId does not match state');
  if (event.sequence !== state.sequence + 1) fail('invalid_input', `event sequence ${event.sequence} is not ${state.sequence + 1}`);
  const tasks = cloneTasks(state.tasks);
  step(tasks, event);
  return Object.freeze({ roomId: state.roomId, sequence: event.sequence, tasks: freezeTasks(tasks) });
}

const EVENT_FIELDS: Record<string, readonly string[]> = {
  'task.created': ['title', 'description', 'createdBy'],
  'task.assigned': ['assignee', 'by'],
  'task.started': ['by'],
  'task.blocked': ['by', 'reason'],
  'task.completed': ['by', 'result'],
  'task.cancelled': ['by', 'reason'],
  'task.handoff': ['from', 'to', 'note'],
};
const BASE_FIELDS = ['version', 'roomId', 'sequence', 'eventId', 'at', 'taskId', 'commandId', 'commandDigest', 'type'];

/** Rebuilds the state from stored events; any violation throws RoomTaskReplayError (fail closed). */
export function replayRoomTasks(roomId: string, events: readonly RoomTaskEvent[]): RoomTaskState {
  const tasks = Object.create(null) as MutableTasks;
  const eventIds = new Set<string>();
  const digests = new Map<string, string>();
  let sequence = -1;
  try {
    if (typeof roomId !== 'string' || !roomId) throw new RoomTaskReplayError('roomId is invalid');
    for (const event of events) {
      if (!event || typeof event !== 'object') throw new RoomTaskReplayError('event is not an object');
      if (event.version !== 1) throw new RoomTaskReplayError(`unsupported event version ${String(event.version)}`);
      if (event.roomId !== roomId) throw new RoomTaskReplayError(`event belongs to room ${String(event.roomId)}`);
      if (event.sequence !== sequence + 1) {
        throw new RoomTaskReplayError(`sequence ${String(event.sequence)} found where ${sequence + 1} was expected`);
      }
      const allowed = EVENT_FIELDS[event.type];
      if (!allowed) throw new RoomTaskReplayError(`unknown event type ${String(event.type)}`);
      for (const key of Object.keys(event)) {
        if (!BASE_FIELDS.includes(key) && !allowed.includes(key)) throw new RoomTaskReplayError(`unexpected field ${key}`);
      }
      text(event.eventId, 'eventId', 256);
      text(event.commandId, 'commandId', 256);
      text(event.commandDigest, 'commandDigest', 256);
      timestamp(event.at);
      if (eventIds.has(event.eventId)) throw new RoomTaskReplayError(`duplicate eventId ${event.eventId}`);
      eventIds.add(event.eventId);
      const known = digests.get(event.commandId);
      if (known !== undefined && known !== event.commandDigest) {
        throw new RoomTaskReplayError(`command ${event.commandId} has inconsistent digests`);
      }
      digests.set(event.commandId, event.commandDigest);
      step(tasks, event);
      sequence = event.sequence;
    }
  } catch (error) {
    if (error instanceof RoomTaskReplayError) throw error;
    throw new RoomTaskReplayError(error instanceof Error ? error.message : String(error));
  }
  return Object.freeze({ roomId, sequence, tasks: freezeTasks(tasks) });
}

// ---------------------------------------------------------------- decide

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) if (item !== undefined) result[key] = item;
  return result as T;
}

/** Digest of the command content, excluding the idempotency key and the (retry-variant) timestamp. */
export function digestRoomTaskCommand(command: RoomTaskCommand): string {
  const { commandId: _commandId, at: _at, ...content } = command as RoomTaskCommand & Record<string, unknown>;
  return digestCanonicalWorkroomValue(omitUndefined(content));
}

export interface DecideRoomTaskOptions {
  /** Event id source; injected so this layer stays free of randomness. */
  readonly newId: () => string;
}

/**
 * Turns a command into events. Returns `[]` when the commandId was already applied with identical
 * content; throws RoomTaskCommandConflictError when it was applied with different content.
 */
export function decideRoomTask(
  state: RoomTaskState,
  history: readonly RoomTaskEvent[],
  command: RoomTaskCommand,
  options: DecideRoomTaskOptions,
): readonly RoomTaskEvent[] {
  const commandId = text(command?.commandId, 'commandId', 256);
  const taskId = taskIdOf(command.taskId);
  const by = text(command.by, 'by', ACTOR_MAX);
  const at = timestamp(command.at);
  const digest = digestRoomTaskCommand(command);
  const prior = history.find(event => event.commandId === commandId);
  if (prior) {
    if (prior.commandDigest !== digest) throw new RoomTaskCommandConflictError(commandId);
    return Object.freeze([]);
  }

  const drafts: Array<Record<string, unknown> & { type: RoomTaskEvent['type'] }> = [];
  switch (command.type) {
    case 'create':
      drafts.push(omitUndefined({ type: 'task.created', title: command.title, description: command.description, createdBy: by }));
      if (command.assignee !== undefined) drafts.push({ type: 'task.assigned', assignee: command.assignee, by });
      break;
    case 'assign':
      drafts.push({ type: 'task.assigned', assignee: command.assignee, by });
      break;
    case 'start':
      drafts.push({ type: 'task.started', by });
      break;
    case 'block':
      drafts.push({ type: 'task.blocked', by, reason: command.reason });
      break;
    case 'complete':
      drafts.push({ type: 'task.completed', by, result: command.result });
      break;
    case 'cancel':
      drafts.push(omitUndefined({ type: 'task.cancelled', by, reason: command.reason }));
      break;
    case 'handoff':
      drafts.push(omitUndefined({ type: 'task.handoff', from: by, to: command.to, note: command.note }));
      break;
    default:
      return fail('invalid_input', `unknown command type ${String((command as { type?: unknown }).type)}`);
  }

  const events: RoomTaskEvent[] = [];
  let working = state;
  for (const draft of drafts) {
    const event = Object.freeze({
      version: 1 as const,
      roomId: state.roomId,
      sequence: working.sequence + 1,
      eventId: options.newId(),
      at,
      taskId,
      commandId,
      commandDigest: digest,
      ...draft,
    }) as RoomTaskEvent;
    working = evolveRoomTasks(working, event);
    events.push(event);
  }
  return Object.freeze(events);
}
