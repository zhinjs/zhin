import { MemoryRoomTaskJournal, RoomTaskSequenceConflictError } from '../../src/room/room-task-journal.js';
import { decideRoomTask, replayRoomTasks, type RoomTaskEvent } from '../../src/room/room-task.js';

let counter = 0;
function make(roomId: string, from: RoomTaskEvent[], command: Record<string, unknown>): readonly RoomTaskEvent[] {
  const state = replayRoomTasks(roomId, from);
  return decideRoomTask(state, from, { commandId: `cmd-${counter++}`, at: 1, ...command } as never, {
    newId: () => `ev-${counter++}`,
  });
}

describe('MemoryRoomTaskJournal', () => {
  it('appends and reads', async () => {
    const journal = new MemoryRoomTaskJournal();
    expect(await journal.read('r')).toEqual([]);
    const first = make('r', [], { type: 'create', taskId: 't', by: 'a', title: 'x', assignee: 'b' });
    await journal.append('r', -1, first);
    const second = make('r', [...first], { type: 'start', taskId: 't', by: 'b' });
    await journal.append('r', 1, second);
    expect((await journal.read('r')).map(e => e.sequence)).toEqual([0, 1, 2]);
  });

  it('rejects stale expectedSequence with a conflict', async () => {
    const journal = new MemoryRoomTaskJournal();
    const first = make('r', [], { type: 'create', taskId: 't', by: 'a', title: 'x' });
    await journal.append('r', -1, first);
    await expect(journal.append('r', -1, first)).rejects.toBeInstanceOf(RoomTaskSequenceConflictError);
  });

  it('is atomic: an illegal event in the batch writes nothing', async () => {
    const journal = new MemoryRoomTaskJournal();
    const [created] = make('r', [], { type: 'create', taskId: 't', by: 'a', title: 'x' });
    const bad = { ...created, sequence: 1, eventId: 'bad', taskId: 't' } as RoomTaskEvent; // duplicate create
    await expect(journal.append('r', -1, [created, bad])).rejects.toThrow();
    expect(await journal.read('r')).toEqual([]);
    await expect(journal.append('r', -1, [created, { ...created, sequence: 5, eventId: 'x2', taskId: 'u' } as RoomTaskEvent])).rejects.toThrow();
    expect(await journal.read('r')).toEqual([]);
  });

  it('rejects events of another room', async () => {
    const journal = new MemoryRoomTaskJournal();
    const other = make('other', [], { type: 'create', taskId: 't', by: 'a', title: 'x' });
    await expect(journal.append('r', -1, other)).rejects.toThrow();
  });

  it('isolates stored data from external mutation', async () => {
    const journal = new MemoryRoomTaskJournal();
    const input = [...make('r', [], { type: 'create', taskId: 't', by: 'a', title: 'x' })].map(e => ({ ...e })) as RoomTaskEvent[];
    const returned = await journal.append('r', -1, input);
    (input[0] as { title: string }).title = 'hacked';
    expect(() => { (returned[0] as { title: string }).title = 'hacked'; }).toThrow();
    const read = await journal.read('r');
    expect(Object.isFrozen(read[0])).toBe(true);
    expect((read[0] as { title: string }).title).toBe('x');
  });

  it('keeps rooms isolated', async () => {
    const journal = new MemoryRoomTaskJournal();
    await journal.append('a', -1, make('a', [], { type: 'create', taskId: 't', by: 'x', title: 'x' }));
    await journal.append('b', -1, make('b', [], { type: 'create', taskId: 't', by: 'x', title: 'y' }));
    expect(await journal.read('a')).toHaveLength(1);
    expect(await journal.read('b')).toHaveLength(1);
    expect(await journal.read('c')).toHaveLength(0);
  });
});
