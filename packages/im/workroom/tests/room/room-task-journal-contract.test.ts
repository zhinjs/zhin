import { DatabaseRoomTaskJournal } from '../../src/room/database-room-task-journal.js';
import { MemoryRoomTaskJournal, RoomTaskSequenceConflictError, type RoomTaskJournal } from '../../src/room/room-task-journal.js';
import { decideRoomTask, replayRoomTasks, type RoomTaskEvent } from '../../src/room/room-task.js';
import { databaseFixture } from './room-task-journal-fixtures.js';

let counter = 0;
function make(from: readonly RoomTaskEvent[], command: Record<string, unknown>): readonly RoomTaskEvent[] {
  return decideRoomTask(replayRoomTasks('r', from), from, { commandId: `cmd-${counter++}`, at: 5, ...command } as never, {
    newId: () => `ev-${counter++}`,
  });
}

describe.each<[string, () => RoomTaskJournal]>([
  ['MemoryRoomTaskJournal', () => new MemoryRoomTaskJournal()],
  ['DatabaseRoomTaskJournal', () => {
    const fixture = databaseFixture();
    return new DatabaseRoomTaskJournal(fixture.database, fixture.model);
  }],
])('%s contract', (_name, create) => {
  it('appends, reads and rejects stale appends', async () => {
    const journal = create();
    const a = make([], { type: 'create', taskId: 't', by: 'lead', title: 'x' });
    expect(await journal.append('r', -1, a)).toEqual(a);
    expect(await journal.read('r')).toEqual(a);
    expect(await journal.read('other')).toEqual([]);
    const b = make(a, { type: 'cancel', taskId: 't', by: 'lead' });
    await expect(journal.append('r', -1, b)).rejects.toBeInstanceOf(RoomTaskSequenceConflictError);
  });

  it('accepts an empty batch with a matching expectedSequence', async () => {
    const journal = create();
    expect(await journal.append('r', -1, [])).toEqual([]);
    const a = make([], { type: 'create', taskId: 't', by: 'lead', title: 'x' });
    await journal.append('r', -1, a);
    expect(await journal.append('r', a.length - 1, [])).toEqual([]);
  });

  it('rejects an empty batch with a stale expectedSequence', async () => {
    const journal = create();
    await expect(journal.append('r', 0, [])).rejects.toBeInstanceOf(RoomTaskSequenceConflictError);
    const a = make([], { type: 'create', taskId: 't', by: 'lead', title: 'x' });
    await journal.append('r', -1, a);
    await expect(journal.append('r', -1, [])).rejects.toBeInstanceOf(RoomTaskSequenceConflictError);
  });

  it.each([-2, 0.5, Number.NaN])('rejects invalid expectedSequence %s', async value => {
    const journal = create();
    await expect(journal.append('r', value, [])).rejects.toThrow();
  });
});
