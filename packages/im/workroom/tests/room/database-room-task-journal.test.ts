import {
  DatabaseRoomTaskJournal,
  ROOM_TASK_EVENT_MODEL,
  defineRoomTaskDatabaseModel,
} from '../../src/room/database-room-task-journal.js';
import { databaseFixture } from './room-task-journal-fixtures.js';
import { RoomTaskJournalCorruptionError, RoomTaskSequenceConflictError } from '../../src/room/room-task-journal.js';
import { createRoomTaskService } from '../../src/room/room-task-service.js';
import { canonicalWorkroomJson, digestCanonicalWorkroomValue } from '../../src/workroom/canonical-value.js';
import { decideRoomTask, replayRoomTasks, type RoomTaskEvent } from '../../src/room/room-task.js';

let counter = 0;
function make(roomId: string, from: readonly RoomTaskEvent[], command: Record<string, unknown>): readonly RoomTaskEvent[] {
  const state = replayRoomTasks(roomId, from);
  return decideRoomTask(state, from, { commandId: `cmd-${counter++}`, at: 5, ...command } as never, {
    newId: () => `ev-${counter++}`,
  });
}

async function seeded() {
  const fixture = databaseFixture();
  const journal = new DatabaseRoomTaskJournal(fixture.database, fixture.model);
  const a = make('r', [], { type: 'create', taskId: 't', by: 'lead', title: 'x', assignee: 'dev' });
  await journal.append('r', -1, a);
  const b = make('r', a, { type: 'start', taskId: 't', by: 'dev' });
  await journal.append('r', 1, b);
  return { ...fixture, journal, events: [...a, ...b] };
}

describe('DatabaseRoomTaskJournal', () => {
  it('registers its schema', () => {
    const define = vi.fn();
    defineRoomTaskDatabaseModel({ define });
    expect(define).toHaveBeenCalledWith('room_task_events', ROOM_TASK_EVENT_MODEL);
  });

  it('uses SERIALIZABLE transactions and reads identical events after restart', async () => {
    const { database, model, journal, events, isolationLevels } = await seeded();
    expect(new Set(isolationLevels)).toEqual(new Set(['SERIALIZABLE']));
    const restarted = new DatabaseRoomTaskJournal(database, model);
    const read = await restarted.read('r');
    expect(read).toEqual(events);
    expect(replayRoomTasks('r', read)).toEqual(replayRoomTasks('r', events));
    expect(await journal.read('other')).toEqual([]);
  });

  it('lets only one of two concurrent appends win', async () => {
    const { journal, events } = await seeded();
    const x = make('r', events, { type: 'block', taskId: 't', by: 'dev', reason: 'one' });
    const y = make('r', events, { type: 'cancel', taskId: 't', by: 'lead' });
    const results = await Promise.allSettled([journal.append('r', 2, x), journal.append('r', 2, y)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(RoomTaskSequenceConflictError);
    expect(await journal.read('r')).toHaveLength(4);
  });

  it('treats an identical batch re-append as idempotent and a stale one as conflict', async () => {
    const { journal, events } = await seeded();
    const x = make('r', events, { type: 'block', taskId: 't', by: 'dev', reason: 'one' });
    await journal.append('r', 2, x);
    expect(await journal.append('r', 2, x)).toEqual(x);
    expect(await journal.read('r')).toHaveLength(4);
    const y = make('r', events, { type: 'cancel', taskId: 't', by: 'lead' });
    await expect(journal.append('r', 2, y)).rejects.toBeInstanceOf(RoomTaskSequenceConflictError);
  });

  describe('fails closed on corruption', () => {
    const cases: Array<[string, (rows: Record<string, unknown>[]) => void]> = [
      ['tampered event_json', rows => { rows[1].event_json = String(rows[1].event_json).replace('dev', 'evil'); }],
      ['non-canonical event_json', rows => { rows[1].event_json = ` ${String(rows[1].event_json)}`; }],
      ['tampered event_digest', rows => { rows[1].event_digest = 'sha256:00'; }],
      ['tampered row_binding_digest', rows => { rows[1].row_binding_digest = 'sha256:00'; }],
      ['sequence gap', rows => { rows.splice(1, 1); rows.push({ ...rows[0], sequence: 2 }); }],
      ['missing middle row', rows => { rows.splice(0, 1); }],
      ['extra column', rows => { rows[0].extra = 1; }],
      ['missing column', rows => { delete rows[0].type; }],
      ['room_id mismatch', rows => { rows[0].room_id = 'other'; }],
    ];
    for (const [name, corrupt] of cases) {
      it(name, async () => {
        const { journal, rows, database, model } = await seeded();
        corrupt(rows);
        await expect(journal.read('r')).rejects.toBeInstanceOf(RoomTaskJournalCorruptionError);
        const next = make('r', [], { type: 'create', taskId: 'z', by: 'a', title: 'z' }).map(e => ({ ...e, sequence: 2 })) as RoomTaskEvent[];
        await expect(journal.append('r', 1, next)).rejects.toThrow();
        const service = createRoomTaskService({ journal: new DatabaseRoomTaskJournal(database, model) });
        await expect(service.execute('r', { type: 'cancel', commandId: 'c-x', taskId: 't', by: 'lead' })).rejects.toThrow();
        expect(rows.length).toBeLessThanOrEqual(3);
      });
    }

    it('rejects an illegal transition stored with consistent digests', async () => {
      const { rows, journal, events } = await seeded();
      const forged = { ...events[2], by: 'intruder' };
      const event_json = canonicalWorkroomJson(forged);
      const event_digest = digestCanonicalWorkroomValue(forged);
      const base = { id: rows[2].id, room_id: 'r', sequence: 2, event_id: forged.eventId, type: forged.type, event_digest };
      Object.assign(rows[2], { event_json, event_digest, row_binding_digest: digestCanonicalWorkroomValue(base) });
      await expect(journal.read('r')).rejects.toBeInstanceOf(RoomTaskJournalCorruptionError);
    });
  });
});
