import type { RoomTaskEvent } from './room-task.js';

/**
 * Room guard components (B4). Pure, independently testable and fail-closed: any internal error, bad
 * configuration or missing data rejects instead of allowing. Nothing here sends messages or touches the
 * Bus; C1 wires the decisions into RoomBus / tools / ingress and projects the "@ human" escalation.
 */

const WINDOW_MS = 60_000;
const SWEEP_THRESHOLD = 1024;

/** Declared structurally; mirrors core's inbound-origin `MessageOrigin` (`self | member | peer_bot | human`). */
export type GuardOrigin = 'self' | 'member' | 'peer_bot' | 'human';

export interface GuardActor {
  readonly origin: GuardOrigin;
  readonly accountId?: string;
}

export type RoomGuardRejectionCode = 'turn_rate' | 'queue_full' | 'cancelled' | 'forbidden' | 'guard_error';

export class RoomGuardRejectedError extends Error {
  constructor(
    readonly code: RoomGuardRejectionCode,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'RoomGuardRejectedError';
  }
}

export type RoomSensitiveOperation = 'task.cancel' | 'role.change' | 'room.cancel_queue';

export interface RoomGuardOptions {
  readonly now?: () => number;
  /** Max `handoffCount` of one Task. Default 8. */
  readonly maxHandoffDepth?: number;
  /** Max back-and-forth handoffs of one Task between the same pair of members. Default 3. */
  readonly maxPingPong?: number;
  /** Max admitted turns per Room in a sliding 60 s window. Default 12. */
  readonly maxTurnsPerMinute?: number;
  /** Max turns waiting behind the running one in one Room. Default 8. */
  readonly maxQueuedTurns?: number;
  /** Human accounts allowed to run sensitive operations. Missing or empty denies everything. */
  readonly sensitiveAccounts?: readonly string[];
  readonly logger?: { warn(message: string): void };
}

export interface RoomHandoffCheckInput {
  readonly roomId: string;
  readonly taskId: string;
  readonly from: string;
  readonly to: string;
  /** `handoffCount` of the RoomTaskView, before this handoff. */
  readonly handoffCount: number;
  /**
   * Room Task journal history. Required: without it the ping-pong limit cannot be checked, so a call that
   * omits it is refused (guard_error + escalateToHuman) instead of silently checking depth only. Pass `[]`
   * for a Task without history.
   */
  readonly history: readonly RoomTaskEvent[];
}

export type RoomHandoffCheck =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly code: 'handoff_depth' | 'ping_pong' | 'guard_error';
      readonly reason: string;
      /** The caller should stop the chain and ask a human (C1 projects the "@ human" message). */
      readonly escalateToHuman: true;
    };

export type RoomTurnAdmission =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: 'turn_rate'; readonly retryAfterMs: number };

export interface RoomCancelResult {
  /** Any human may interrupt the running turn. */
  readonly cancelledRunning: boolean;
  /** Always 0 unless the actor passes `authorizeSensitive('room.cancel_queue')`. */
  readonly cancelledQueued: number;
}

export interface RoomGuardStats {
  /** Rooms with a running or queued turn. */
  readonly lanes: number;
  /** Rooms with a rate window entry. */
  readonly rateWindows: number;
}

export interface RoomGuards {
  checkHandoff(input: RoomHandoffCheckInput): RoomHandoffCheck;
  /**
   * Runs `work` as the next turn of the Room: admitted by the rate window (this is the only admission path;
   * the window is internal, so one turn consumes exactly one slot), FIFO-serialized per Room
   * (a failed turn does not affect the next one) and abortable via `cancelRoom`.
   *
   * Do NOT re-enter: calling runExclusive for the same Room from inside `work` and awaiting it deadlocks.
   * Schedule follow-up turns after `work` has returned.
   */
  runExclusive<T>(roomId: string, work: (signal: AbortSignal) => Promise<T>): Promise<T>;
  /**
   * Human interrupt. Any human aborts the RUNNING turn; rejecting and clearing the queued turns additionally
   * requires `authorizeSensitive('room.cancel_queue', actor) === undefined` (a configured sensitive account).
   * Non-humans are refused (throws).
   */
  cancelRoom(roomId: string, actor: GuardActor): RoomCancelResult;
  /** Returns undefined when allowed, otherwise the refusal reason (RoomTaskServiceOptions.authorize style). */
  authorizeSensitive(op: RoomSensitiveOperation, actor: GuardActor | undefined): string | undefined;
  stats(): RoomGuardStats;
}

/**
 * Counts `task.handoff` events of `taskId` between members `a` and `b` in either direction.
 * Pure over the journal history, so the result survives restarts and is reproducible.
 */
export function countPairHandoffs(events: readonly RoomTaskEvent[], taskId: string, a: string, b: string): number {
  let count = 0;
  for (const event of events) {
    if (event.type !== 'task.handoff' || event.taskId !== taskId) continue;
    if ((event.from === a && event.to === b) || (event.from === b && event.to === a)) count += 1;
  }
  return count;
}

function positive(name: string, value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new RangeError(`Room guard option ${name} must be a positive integer, got ${String(resolved)}`);
  }
  return resolved;
}

interface QueuedTurn {
  cancelled: boolean;
  readonly controller: AbortController;
  rejectCancelled(error: RoomGuardRejectedError): void;
}

interface Lane {
  tail: Promise<unknown>;
  running?: QueuedTurn;
  readonly queued: Set<QueuedTurn>;
}

export function createRoomGuards(options: RoomGuardOptions = {}): RoomGuards {
  const now = options.now ?? (() => Date.now());
  const maxHandoffDepth = positive('maxHandoffDepth', options.maxHandoffDepth, 8);
  const maxPingPong = positive('maxPingPong', options.maxPingPong, 3);
  const maxTurnsPerMinute = positive('maxTurnsPerMinute', options.maxTurnsPerMinute, 12);
  const maxQueuedTurns = positive('maxQueuedTurns', options.maxQueuedTurns, 8);
  const { logger } = options;
  if (options.sensitiveAccounts !== undefined && !Array.isArray(options.sensitiveAccounts)) {
    throw new TypeError('Room guard option sensitiveAccounts must be an array of account ids');
  }
  const sensitive = new Set<string>();
  for (const account of options.sensitiveAccounts ?? []) {
    if (typeof account !== 'string') throw new TypeError('Room guard option sensitiveAccounts must contain strings only');
    const trimmed = account.trim();
    if (trimmed !== '') sensitive.add(trimmed);
  }

  const windows = new Map<string, number[]>();
  const lanes = new Map<string, Lane>();

  const prune = (stamps: number[], at: number): void => {
    while (stamps.length > 0 && stamps[0] <= at - WINDOW_MS) stamps.shift();
  };

  const sweepWindows = (at: number): void => {
    for (const [room, stamps] of windows) {
      prune(stamps, at);
      if (stamps.length === 0) windows.delete(room);
    }
  };

  const guardError = (error: unknown): string =>
    `guard error: ${error instanceof Error ? error.message : String(error)}`;

  const admitTurn = (roomId: string): RoomTurnAdmission => {
    try {
      if (typeof roomId !== 'string' || roomId === '') throw new TypeError('roomId must be a non-empty string');
      const at = now();
      if (!Number.isFinite(at)) throw new TypeError('clock returned a non-finite value');
      if (windows.size >= SWEEP_THRESHOLD) sweepWindows(at);
      const stamps = windows.get(roomId) ?? [];
      prune(stamps, at);
      if (stamps.length >= maxTurnsPerMinute) {
        windows.set(roomId, stamps);
        return { allowed: false, code: 'turn_rate', retryAfterMs: Math.max(1, stamps[0] + WINDOW_MS - at) };
      }
      stamps.push(at);
      windows.set(roomId, stamps);
      return { allowed: true };
    } catch (error) {
      logger?.warn(`room turn admission failed closed: ${guardError(error)}`);
      return { allowed: false, code: 'turn_rate', retryAfterMs: WINDOW_MS };
    }
  };

  const requireHuman = (actor: GuardActor | undefined): boolean => actor?.origin === 'human';

  const authorizeSensitive = (op: RoomSensitiveOperation, actor: GuardActor | undefined): string | undefined => {
    try {
      if (!requireHuman(actor)) return `${op} requires a human actor`;
      const account = typeof actor?.accountId === 'string' ? actor.accountId.trim() : '';
      if (account === '') return `${op} requires an identified account`;
      if (!sensitive.has(account)) return `${op} is not allowed for this account`;
      return undefined;
    } catch (error) {
      return guardError(error);
    }
  };

  return Object.freeze({
    checkHandoff(input: RoomHandoffCheckInput): RoomHandoffCheck {
      try {
        const { roomId, taskId, from, to, handoffCount, history } = input;
        if ([roomId, taskId, from, to].some((v) => typeof v !== 'string' || v === '')) {
          throw new TypeError('roomId, taskId, from and to must be non-empty strings');
        }
        if (!Number.isSafeInteger(handoffCount) || handoffCount < 0) {
          throw new TypeError('handoffCount must be a non-negative integer');
        }
        if (!Array.isArray(history)) throw new TypeError('history is required');
        if (handoffCount >= maxHandoffDepth) {
          return {
            allowed: false, code: 'handoff_depth', escalateToHuman: true,
            reason: `task ${taskId} reached the handoff depth limit (${maxHandoffDepth})`,
          };
        }
        const pair = countPairHandoffs(history, taskId, from, to);
        if (pair >= maxPingPong) {
          return {
            allowed: false, code: 'ping_pong', escalateToHuman: true,
            reason: `task ${taskId} bounced ${pair} times between ${from} and ${to} (limit ${maxPingPong})`,
          };
        }
        return { allowed: true };
      } catch (error) {
        logger?.warn(`room handoff check failed closed: ${guardError(error)}`);
        return { allowed: false, code: 'guard_error', escalateToHuman: true, reason: guardError(error) };
      }
    },

    runExclusive<T>(roomId: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
      if (typeof roomId !== 'string' || roomId === '') {
        return Promise.reject(new RoomGuardRejectedError('guard_error', 'roomId must be a non-empty string'));
      }
      const existing = lanes.get(roomId);
      if (existing && existing.queued.size >= maxQueuedTurns) {
        return Promise.reject(new RoomGuardRejectedError('queue_full', `room ${roomId} already has ${existing.queued.size} queued turns`));
      }
      const admission = admitTurn(roomId);
      if (!admission.allowed) {
        return Promise.reject(new RoomGuardRejectedError(
          'turn_rate', `room ${roomId} exceeded ${maxTurnsPerMinute} turns per minute`, admission.retryAfterMs));
      }

      const lane: Lane = existing ?? { tail: Promise.resolve(), queued: new Set() };
      if (!existing) lanes.set(roomId, lane);

      return new Promise<T>((resolve, reject) => {
        const turn: QueuedTurn = {
          cancelled: false,
          controller: new AbortController(),
          rejectCancelled: reject,
        };
        lane.queued.add(turn);

        const start = async (): Promise<T> => {
          lane.queued.delete(turn);
          if (turn.cancelled) throw new RoomGuardRejectedError('cancelled', `room ${roomId} turn was cancelled before it started`);
          lane.running = turn;
          try {
            return await work(turn.controller.signal);
          } finally {
            lane.running = undefined;
          }
        };

        const run = lane.tail.then(start, start);
        run.then(resolve, reject);
        const tail = run.catch(() => undefined);
        lane.tail = tail;
        void tail.then(() => {
          if (lane.tail === tail && lanes.get(roomId) === lane) lanes.delete(roomId);
        });
      });
    },

    cancelRoom(roomId: string, actor: GuardActor): RoomCancelResult {
      if (!requireHuman(actor)) {
        throw new RoomGuardRejectedError('forbidden', 'only a human may cancel a room turn');
      }
      const lane = lanes.get(roomId);
      if (!lane) return { cancelledRunning: false, cancelledQueued: 0 };
      let cancelledRunning = false;
      if (lane.running && !lane.running.controller.signal.aborted) {
        lane.running.controller.abort(new RoomGuardRejectedError('cancelled', `room ${roomId} turn was cancelled by a human`));
        cancelledRunning = true;
      }
      let cancelledQueued = 0;
      if (authorizeSensitive('room.cancel_queue', actor) !== undefined) return { cancelledRunning, cancelledQueued };
      for (const turn of lane.queued) {
        turn.cancelled = true;
        turn.controller.abort();
        turn.rejectCancelled(new RoomGuardRejectedError('cancelled', `room ${roomId} turn was cancelled by a human`));
        cancelledQueued += 1;
      }
      lane.queued.clear();
      return { cancelledRunning, cancelledQueued };
    },

    authorizeSensitive,

    stats(): RoomGuardStats {
      return { lanes: lanes.size, rateWindows: windows.size };
    },
  });
}
