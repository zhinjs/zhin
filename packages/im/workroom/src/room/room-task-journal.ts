import { deepFreezeWorkroomValue } from '../workroom/canonical-value.js';
import { replayRoomTasks, type RoomTaskEvent } from './room-task.js';

/** One append-only event stream per Room. */
export interface RoomTaskJournal {
  read(roomId: string): Promise<readonly RoomTaskEvent[]>;
  /**
   * Compare-and-set append. `expectedSequence` is the sequence of the last stored event (-1 when empty).
   * The batch is written atomically: all events or none.
   */
  append(roomId: string, expectedSequence: number, events: readonly RoomTaskEvent[]): Promise<readonly RoomTaskEvent[]>;
}

export class RoomTaskSequenceConflictError extends Error {
  constructor(readonly roomId: string, readonly expected: number, readonly actual: number) {
    super(`Room Task journal for ${roomId} expected sequence ${expected} but found ${actual}`);
    this.name = 'RoomTaskSequenceConflictError';
  }
}

export class RoomTaskJournalCorruptionError extends Error {
  constructor(message: string) {
    super(`Room Task journal is corrupt: ${message}`);
    this.name = 'RoomTaskJournalCorruptionError';
  }
}

/** Shared batch checks: scope, contiguity from expectedSequence + 1 and a full replay of the result. */
export function assertRoomTaskAppend(
  roomId: string,
  current: readonly RoomTaskEvent[],
  expectedSequence: number,
  events: readonly RoomTaskEvent[],
): void {
  const actual = current.length - 1;
  if (actual !== expectedSequence) throw new RoomTaskSequenceConflictError(roomId, expectedSequence, actual);
  events.forEach((event, index) => {
    if (event.roomId !== roomId) throw new Error(`Room Task append scope drift: event belongs to room ${String(event.roomId)}`);
    if (event.sequence !== expectedSequence + 1 + index) throw new Error('Room Task append sequence is not contiguous');
  });
  replayRoomTasks(roomId, [...current, ...events]);
}

export class MemoryRoomTaskJournal implements RoomTaskJournal {
  readonly #rooms = new Map<string, readonly RoomTaskEvent[]>();

  async read(roomId: string): Promise<readonly RoomTaskEvent[]> {
    return this.#rooms.get(roomId) ?? Object.freeze([]);
  }

  async append(
    roomId: string,
    expectedSequence: number,
    events: readonly RoomTaskEvent[],
  ): Promise<readonly RoomTaskEvent[]> {
    const current = this.#rooms.get(roomId) ?? [];
    // Copy first so later mutation of the caller's objects cannot reach the store.
    const copy = events.map(event => JSON.parse(JSON.stringify(event)) as RoomTaskEvent);
    assertRoomTaskAppend(roomId, current, expectedSequence, copy);
    const frozen = copy.map(event => deepFreezeWorkroomValue(event));
    this.#rooms.set(roomId, Object.freeze([...current, ...frozen]));
    return Object.freeze(frozen);
  }
}
