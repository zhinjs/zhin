import { DatabaseRoomTaskJournal, type RoomTaskDatabase, type RoomTaskDatabaseModel } from '../../src/room/database-room-task-journal.js';
import { MemoryRoomTaskJournal, RoomTaskSequenceConflictError, type RoomTaskJournal } from '../../src/room/room-task-journal.js';
import { RoomTaskAuthorizationError, createRoomTaskService } from '../../src/room/room-task-service.js';
import type { RoomTaskEvent } from '../../src/room/room-task.js';

let ids = 0;
const options = (journal: RoomTaskJournal, extra: Record<string, unknown> = {}) => ({
  journal, newId: () => `e${ids++}`, now: () => 42, ...extra,
});

describe('Room Task service', () => {
  it('runs a whole lifecycle', async () => {
    const service = createRoomTaskService(options(new MemoryRoomTaskJournal()));
    await service.execute('r', { type: 'create', commandId: 'c1', taskId: 't', by: 'lead', title: 'x', assignee: 'dev' });
    await service.execute('r', { type: 'start', commandId: 'c2', taskId: 't', by: 'dev' });
    const done = await service.execute('r', { type: 'complete', commandId: 'c3', taskId: 't', by: 'dev', result: 'ok' });
    expect(done.state.status).toBe('done');
    expect(done.replayed).toBe(false);
    expect(done.events[0].at).toBe(42);
    const again = await service.execute('r', { type: 'complete', commandId: 'c3', taskId: 't', by: 'dev', result: 'ok' });
    expect(again.replayed).toBe(true);
    expect(await service.list('r', { status: 'done' })).toHaveLength(1);
    expect(await service.list('r', { assignee: 'nobody' })).toHaveLength(0);
    expect(await service.get('r', 't')).toMatchObject({ status: 'done', result: 'ok' });
  });

  it('serializes concurrent commands in one room', async () => {
    const service = createRoomTaskService(options(new MemoryRoomTaskJournal()));
    await service.execute('r', { type: 'create', commandId: 'c0', taskId: 't', by: 'lead', title: 'x' });
    const results = await Promise.allSettled([
      service.execute('r', { type: 'assign', commandId: 'a', taskId: 't', by: 'lead', assignee: 'dev' }),
      service.execute('r', { type: 'assign', commandId: 'b', taskId: 't', by: 'lead', assignee: 'qa' }),
      service.execute('r', { type: 'create', commandId: 'c', taskId: 'u', by: 'lead', title: 'y' }),
    ]);
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);
    expect((await service.get('r', 't'))?.assignee).toBe('qa');
    expect(await service.list('r')).toHaveLength(2);
  });

  it('retries a lost sequence race', async () => {
    const inner = new MemoryRoomTaskJournal();
    let failures = 1;
    const flaky: RoomTaskJournal = {
      read: room => inner.read(room),
      append: async (room, expected, events) => {
        if (failures-- > 0) throw new RoomTaskSequenceConflictError(room, expected, expected + 1);
        return await inner.append(room, expected, events);
      },
    };
    const service = createRoomTaskService(options(flaky));
    const result = await service.execute('r', { type: 'create', commandId: 'c', taskId: 't', by: 'lead', title: 'x' });
    expect(result.state.id).toBe('t');
  });

  it('gives up after three lost races', async () => {
    let calls = 0;
    const inner = new MemoryRoomTaskJournal();
    const always: RoomTaskJournal = {
      read: room => inner.read(room),
      append: async (room, expected) => { calls += 1; throw new RoomTaskSequenceConflictError(room, expected, expected + 1); },
    };
    const service = createRoomTaskService(options(always));
    await expect(service.execute('r', { type: 'create', commandId: 'c', taskId: 't', by: 'lead', title: 'x' })).rejects.toThrow();
    expect(calls).toBe(3);
  });

  it('notifies subscribers after persistence and survives subscriber errors', async () => {
    const warn = vi.fn();
    const journal = new MemoryRoomTaskJournal();
    const service = createRoomTaskService(options(journal, { logger: { warn } }));
    const seen: RoomTaskEvent[] = [];
    service.subscribe(async event => { seen.push(event); expect(await journal.read('r')).toContainEqual(event); });
    service.subscribe(() => { throw new Error('boom'); });
    const result = await service.execute('r', { type: 'create', commandId: 'c', taskId: 't', by: 'lead', title: 'x' });
    expect(result.state.status).toBe('created');
    expect(seen).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
  });

  it('subscriber that calls execute on the same Room does not deadlock', async () => {
    const journal = new MemoryRoomTaskJournal();
    const service = createRoomTaskService(options(journal));
    let inner: Promise<unknown> | undefined;
    service.subscribe(event => {
      if (event.type === 'task.created') {
        inner = service.execute('r', { type: 'assign', commandId: 'inner', taskId: 't', by: 'lead', assignee: 'dev' });
        return inner.then(() => undefined);
      }
    });
    const guard = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('deadlock')), 2000));
    await Promise.race([
      service.execute('r', { type: 'create', commandId: 'outer', taskId: 't', by: 'lead', title: 'x' }),
      guard,
    ]);
    await Promise.race([inner, guard]);
    expect((await journal.read('r')).map(event => event.sequence)).toEqual([0, 1]);
    expect(await service.get('r', 't')).toMatchObject({ status: 'assigned', assignee: 'dev' });
  });

  it('slow subscriber does not block other commands', async () => {
    const service = createRoomTaskService(options(new MemoryRoomTaskJournal()));
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    service.subscribe(async event => { if (event.type === 'task.created' && event.taskId === 't') await gate; });
    const slow = service.execute('r', { type: 'create', commandId: 'c1', taskId: 't', by: 'lead', title: 'x' });
    await new Promise(resolve => setTimeout(resolve, 10));
    const second = await service.execute('r', { type: 'create', commandId: 'c2', taskId: 'u', by: 'lead', title: 'y' });
    expect(second.state.id).toBe('u');
    release();
    await slow;
  });

  it('does not dispatch again on a replayed commandId', async () => {
    const service = createRoomTaskService(options(new MemoryRoomTaskJournal()));
    const listener = vi.fn();
    service.subscribe(listener);
    const command = { type: 'create', commandId: 'c', taskId: 't', by: 'lead', title: 'x' } as const;
    await service.execute('r', command);
    const again = await service.execute('r', command);
    expect(again.replayed).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify for failed or replayed commands', async () => {
    const service = createRoomTaskService(options(new MemoryRoomTaskJournal()));
    const listener = vi.fn();
    service.subscribe(listener);
    await service.execute('r', { type: 'create', commandId: 'c', taskId: 't', by: 'lead', title: 'x' });
    await service.execute('r', { type: 'create', commandId: 'c', taskId: 't', by: 'lead', title: 'x' });
    await expect(service.execute('r', { type: 'start', commandId: 'd', taskId: 't', by: 'dev' })).rejects.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('honours the authorize hook without writing', async () => {
    const journal = new MemoryRoomTaskJournal();
    const service = createRoomTaskService(options(journal, {
      authorize: (_room: string, command: { by: string }) => command.by === 'human' ? 'humans cannot do this' : undefined,
    }));
    await expect(service.execute('r', { type: 'create', commandId: 'c', taskId: 't', by: 'human', title: 'x' }))
      .rejects.toBeInstanceOf(RoomTaskAuthorizationError);
    expect(await journal.read('r')).toEqual([]);
  });

  it('recovers identical state from a database journal after rebuild', async () => {
    const rows: Record<string, unknown>[] = [];
    const select = (q: Record<string, unknown>) => rows.filter(r => Object.entries(q).every(([k, v]) => r[k] === v));
    const model: RoomTaskDatabaseModel = { select: () => ({ where: async q => select(q) }) };
    const database: RoomTaskDatabase = {
      transaction: async op => await op({
        select: () => ({ where: async q => select(q) }),
        insertMany: async (_t, inserted) => { rows.push(...inserted); },
      }),
    };
    const first = createRoomTaskService(options(new DatabaseRoomTaskJournal(database, model)));
    await first.execute('r', { type: 'create', commandId: 'c1', taskId: 't', by: 'lead', title: 'x', assignee: 'dev' });
    await first.execute('r', { type: 'start', commandId: 'c2', taskId: 't', by: 'dev' });
    await first.execute('r', { type: 'handoff', commandId: 'c3', taskId: 't', by: 'dev', to: 'qa' });
    const rebuilt = createRoomTaskService(options(new DatabaseRoomTaskJournal(database, model)));
    expect(await rebuilt.get('r', 't')).toEqual(await first.get('r', 't'));
    expect(await rebuilt.list('r')).toEqual(await first.list('r'));
    expect(await rebuilt.get('r', 't')).toMatchObject({ assignee: 'qa', status: 'assigned', handoffCount: 1 });
  });
});
