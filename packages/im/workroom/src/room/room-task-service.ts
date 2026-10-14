import { randomUUID } from 'node:crypto';
import {
  decideRoomTask,
  findRoomTask,
  replayRoomTasks,
  type RoomTaskCommand,
  type RoomTaskEvent,
  type RoomTaskState,
  type RoomTaskStatus,
  type RoomTaskView,
} from './room-task.js';
import { RoomTaskSequenceConflictError, type RoomTaskJournal } from './room-task-journal.js';

export class RoomTaskAuthorizationError extends Error {
  constructor(readonly reason: string) {
    super(`Room Task command refused: ${reason}`);
    this.name = 'RoomTaskAuthorizationError';
  }
}

export interface RoomTaskExecuteResult {
  readonly events: readonly RoomTaskEvent[];
  readonly state: RoomTaskView;
  /** True when the commandId was already applied (idempotent hit); no new events were written. */
  readonly replayed: boolean;
}

export interface RoomTaskListFilter {
  readonly status?: RoomTaskStatus;
  readonly assignee?: string;
}

export interface RoomTaskServiceOptions {
  readonly journal: RoomTaskJournal;
  readonly newId?: () => string;
  /** Source of command timestamps' default and nothing else; the pure layer never reads a clock. */
  readonly now?: () => number;
  /**
   * Hook for membership / role checks (done by the caller layer, not the state machine).
   * Return a refusal reason to reject the command; return undefined to allow it.
   */
  readonly authorize?: (roomId: string, command: RoomTaskCommand) => string | undefined;
  readonly logger?: { warn(message: string): void };
}

export type RoomTaskExecuteInput = Omit<RoomTaskCommand, 'at'> & { readonly at?: number };

export interface RoomTaskService {
  execute(roomId: string, command: RoomTaskExecuteInput): Promise<RoomTaskExecuteResult>;
  get(roomId: string, taskId: string): Promise<RoomTaskView | undefined>;
  list(roomId: string, filter?: RoomTaskListFilter): Promise<readonly RoomTaskView[]>;
  subscribe(listener: (event: RoomTaskEvent) => void | Promise<void>): () => void;
}

const MAX_ATTEMPTS = 3;

/*
 * Not wired to RoomBus on purpose: the group-visible projection of a handoff stays in room-bus and is
 * composed with this service in C1. Do not project group messages from here in B3.
 */
export function createRoomTaskService(options: RoomTaskServiceOptions): RoomTaskService {
  const { journal, authorize, logger } = options;
  const newId = options.newId ?? (() => randomUUID());
  const now = options.now ?? (() => Date.now());
  const listeners = new Set<(event: RoomTaskEvent) => void | Promise<void>>();
  const tails = new Map<string, Promise<unknown>>();

  const serialized = <T>(roomId: string, work: () => Promise<T>): Promise<T> => {
    const previous = tails.get(roomId) ?? Promise.resolve();
    const run = previous.then(work, work);
    const tail = run.catch(() => undefined);
    tails.set(roomId, tail);
    void tail.then(() => { if (tails.get(roomId) === tail) tails.delete(roomId); });
    return run;
  };

  const load = async (roomId: string): Promise<{ history: readonly RoomTaskEvent[]; state: RoomTaskState }> => {
    const history = await journal.read(roomId);
    return { history, state: replayRoomTasks(roomId, history) };
  };

  const dispatch = async (events: readonly RoomTaskEvent[]): Promise<void> => {
    for (const listener of [...listeners]) {
      for (const event of events) {
        try {
          await listener(event);
        } catch (error) {
          logger?.warn(`room task subscriber failed for ${event.eventId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  };

  const run = async (roomId: string, input: RoomTaskExecuteInput): Promise<RoomTaskExecuteResult> => {
    const command = { ...input, at: input.at ?? now() } as RoomTaskCommand;
    const refusal = authorize?.(roomId, command);
    if (refusal !== undefined) throw new RoomTaskAuthorizationError(refusal);
    for (let attempt = 1; ; attempt += 1) {
      const { history, state } = await load(roomId);
      const events = decideRoomTask(state, history, command, { newId });
      if (events.length === 0) {
        const view = findRoomTask(state, command.taskId);
        if (!view) throw new Error(`Room Task ${command.taskId} missing after idempotent replay`);
        return Object.freeze({ events, state: view, replayed: true });
      }
      try {
        const stored = await journal.append(roomId, state.sequence, events);
        const next = replayRoomTasks(roomId, [...history, ...stored]);
        const view = findRoomTask(next, command.taskId) as RoomTaskView;
        await dispatch(stored);
        return Object.freeze({ events: stored, state: view, replayed: false });
      } catch (error) {
        if (!(error instanceof RoomTaskSequenceConflictError)) throw error;
        if (attempt >= MAX_ATTEMPTS) {
          throw new Error(`Room Task command ${command.commandId} lost ${MAX_ATTEMPTS} sequence races in room ${roomId}`, { cause: error });
        }
      }
    }
  };

  return Object.freeze({
    execute: (roomId: string, command: RoomTaskExecuteInput) => serialized(roomId, () => run(roomId, command)),
    async get(roomId: string, taskId: string) {
      return findRoomTask((await load(roomId)).state, taskId);
    },
    async list(roomId: string, filter?: RoomTaskListFilter) {
      const { state } = await load(roomId);
      return Object.freeze(Object.values(state.tasks).filter(view =>
        (filter?.status === undefined || view.status === filter.status)
        && (filter?.assignee === undefined || view.assignee === filter.assignee)));
    },
    subscribe(listener: (event: RoomTaskEvent) => void | Promise<void>) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  });
}
