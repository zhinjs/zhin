import { createHash } from 'node:crypto';
import { canonicalWorkroomJson, digestCanonicalWorkroomValue, deepFreezeWorkroomValue } from '../workroom/canonical-value.js';
import { replayRoomTasks, type RoomTaskEvent } from './room-task.js';
import {
  RoomTaskJournalCorruptionError,
  RoomTaskSequenceConflictError,
  assertRoomTaskAppend,
  type RoomTaskJournal,
} from './room-task-journal.js';

export const ROOM_TASK_EVENTS_TABLE = 'room_task_events';

export interface RoomTaskDatabaseModel {
  select(...fields: string[]): { where(query: Record<string, unknown>): Promise<Record<string, unknown>[]> };
}

export interface RoomTaskDatabaseTransaction {
  select(table: string): { where(query: Record<string, unknown>): Promise<Record<string, unknown>[]> };
  insertMany(table: string, rows: Record<string, unknown>[]): Promise<unknown>;
}

export interface RoomTaskDatabase {
  transaction<T>(
    operation: (transaction: RoomTaskDatabaseTransaction) => Promise<T>,
    options: { isolationLevel: 'SERIALIZABLE' },
  ): Promise<T>;
}

export const ROOM_TASK_EVENT_MODEL = {
  id: { type: 'text' as const, primary: true, nullable: false },
  room_id: { type: 'text' as const, nullable: false },
  sequence: { type: 'integer' as const, nullable: false },
  event_id: { type: 'text' as const, nullable: false },
  type: { type: 'text' as const, nullable: false },
  event_digest: { type: 'text' as const, nullable: false },
  event_json: { type: 'text' as const, nullable: false },
  row_binding_digest: { type: 'text' as const, nullable: false },
};

/** Registers the table schema. Not wired into defineWorkroomDatabaseModels yet (runtime wiring is C1). */
export function defineRoomTaskDatabaseModel(
  database: Readonly<{ define(name: string, definition: unknown): void }>,
): void {
  database.define(ROOM_TASK_EVENTS_TABLE, ROOM_TASK_EVENT_MODEL);
}

const COLUMNS = Object.keys(ROOM_TASK_EVENT_MODEL);

export class DatabaseRoomTaskJournal implements RoomTaskJournal {
  constructor(
    readonly database: RoomTaskDatabase,
    readonly model: RoomTaskDatabaseModel,
  ) {}

  async read(roomId: string): Promise<readonly RoomTaskEvent[]> {
    const id = requiredRoom(roomId);
    return parseRows(id, await this.model.select().where({ room_id: id }));
  }

  async append(
    roomId: string,
    expectedSequence: number,
    events: readonly RoomTaskEvent[],
  ): Promise<readonly RoomTaskEvent[]> {
    const id = requiredRoom(roomId);
    if (!Number.isSafeInteger(expectedSequence) || expectedSequence < -1) throw new Error('expectedSequence is invalid');
    if (events.length === 0) {
      assertRoomTaskAppend(id, await this.read(id), expectedSequence, []);
      return Object.freeze([]);
    }
    const batch = events.map(event => JSON.parse(JSON.stringify(event)) as RoomTaskEvent);
    try {
      return await this.database.transaction(async transaction => {
        const current = parseRows(id, await transaction.select(ROOM_TASK_EVENTS_TABLE).where({ room_id: id }));
        assertRoomTaskAppend(id, current, expectedSequence, batch);
        await transaction.insertMany(ROOM_TASK_EVENTS_TABLE, batch.map(toRow));
        return deepFreezeWorkroomValue(batch);
      }, { isolationLevel: 'SERIALIZABLE' });
    } catch (error) {
      if (error instanceof RoomTaskJournalCorruptionError) throw error;
      // Lost a race, retried an already-written batch, or committed before failing: reread and classify.
      const winner = await this.read(id);
      const written = winner.slice(expectedSequence + 1, expectedSequence + 1 + batch.length);
      if (written.length === batch.length
        && written.every((event, index) => canonicalWorkroomJson(event) === canonicalWorkroomJson(batch[index]))) {
        return written;
      }
      const actual = winner.length - 1;
      if (actual !== expectedSequence) throw new RoomTaskSequenceConflictError(id, expectedSequence, actual);
      throw error;
    }
  }
}

function requiredRoom(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error('roomId is invalid');
  return value;
}

function rowId(roomId: string, sequence: number): string {
  return `${createHash('sha256').update(roomId).digest('hex')}:${sequence}`;
}

function bindingDigest(row: { id: string; room_id: string; sequence: number; event_id: string; type: string; event_digest: string }): string {
  return digestCanonicalWorkroomValue({
    id: row.id,
    room_id: row.room_id,
    sequence: row.sequence,
    event_id: row.event_id,
    type: row.type,
    event_digest: row.event_digest,
  });
}

function toRow(event: RoomTaskEvent): Record<string, unknown> {
  const base = {
    id: rowId(event.roomId, event.sequence),
    room_id: event.roomId,
    sequence: event.sequence,
    event_id: event.eventId,
    type: event.type,
    event_digest: digestCanonicalWorkroomValue(event),
  };
  return {
    ...base,
    event_json: canonicalWorkroomJson(event),
    row_binding_digest: bindingDigest(base),
  };
}

function corrupt(message: string): never {
  throw new RoomTaskJournalCorruptionError(message);
}

function parseRows(roomId: string, rows: readonly Record<string, unknown>[]): readonly RoomTaskEvent[] {
  for (const row of rows) {
    const keys = Object.keys(row);
    if (keys.length !== COLUMNS.length || COLUMNS.some(key => !Object.hasOwn(row, key))) corrupt('row column set drift');
    if (!Number.isSafeInteger(row.sequence) || Number(row.sequence) < 0) corrupt('row sequence is invalid');
  }
  const sorted = [...rows].sort((left, right) => Number(left.sequence) - Number(right.sequence));
  const events = sorted.map((row, index) => {
    if (row.room_id !== roomId) corrupt('row room_id drift');
    if (Number(row.sequence) !== index) corrupt(`sequence gap or duplicate at ${index}`);
    if (row.id !== rowId(roomId, index)) corrupt(`row id drift at ${index}`);
    if (typeof row.event_json !== 'string') corrupt('event_json is not text');
    let event: RoomTaskEvent;
    try {
      event = JSON.parse(row.event_json as string) as RoomTaskEvent;
    } catch {
      return corrupt(`event_json is not valid JSON at ${index}`);
    }
    if (canonicalWorkroomJson(event) !== row.event_json) corrupt(`event_json is not canonical at ${index}`);
    if (digestCanonicalWorkroomValue(event) !== row.event_digest) corrupt(`event_digest mismatch at ${index}`);
    if (event.sequence !== index || event.roomId !== roomId || event.eventId !== row.event_id || event.type !== row.type) {
      corrupt(`row/event binding drift at ${index}`);
    }
    const expected = bindingDigest({
      id: row.id as string,
      room_id: row.room_id as string,
      sequence: index,
      event_id: row.event_id as string,
      type: row.type as string,
      event_digest: row.event_digest as string,
    });
    if (row.row_binding_digest !== expected) corrupt(`row_binding_digest mismatch at ${index}`);
    return event;
  });
  try {
    replayRoomTasks(roomId, events);
  } catch (error) {
    corrupt(error instanceof Error ? error.message : String(error));
  }
  return deepFreezeWorkroomValue(Object.freeze(events));
}
