import {
  ROOM_TASK_STATUSES,
  RoomTaskCommandConflictError,
  RoomTaskReplayError,
  RoomTaskTransitionError,
  decideRoomTask,
  emptyRoomTaskState,
  findRoomTask,
  replayRoomTasks,
  type RoomTaskCommand,
  type RoomTaskEvent,
} from '../../src/room/room-task.js';

const ROOM = 'dev-room';

function harness() {
  let n = 0;
  let c = 0;
  const events: RoomTaskEvent[] = [];
  const run = (command: Omit<RoomTaskCommand, 'commandId' | 'at'> & { commandId?: string }) => {
    const state = replayRoomTasks(ROOM, events);
    const out = decideRoomTask(state, events, { commandId: `c${c++}`, at: 1000 + c, ...command } as RoomTaskCommand, {
      newId: () => `e${n++}`,
    });
    events.push(...out);
    return out;
  };
  const view = (id = 't1') => findRoomTask(replayRoomTasks(ROOM, events), id);
  return { run, view, events };
}

const code = (fn: () => unknown) => {
  try { fn(); } catch (e) { return e instanceof RoomTaskTransitionError ? e.code : `other:${String(e)}`; }
  return 'no-throw';
};

describe('Room Task state machine', () => {
  it('has exactly the six statuses (no lease / preempt concepts)', () => {
    expect([...ROOM_TASK_STATUSES].sort()).toEqual(['assigned', 'blocked', 'cancelled', 'created', 'done', 'in_progress']);
  });

  it('walks created -> assigned -> in_progress -> done', () => {
    const h = harness();
    h.run({ type: 'create', taskId: 't1', by: 'lead', title: 'Ship it' });
    expect(h.view()?.status).toBe('created');
    h.run({ type: 'assign', taskId: 't1', by: 'lead', assignee: 'dev' });
    expect(h.view()).toMatchObject({ status: 'assigned', assignee: 'dev' });
    h.run({ type: 'start', taskId: 't1', by: 'dev' });
    h.run({ type: 'complete', taskId: 't1', by: 'dev', result: 'merged' });
    expect(h.view()).toMatchObject({ status: 'done', result: 'merged' });
    expect(h.events.map(e => e.sequence)).toEqual([0, 1, 2, 3]);
  });

  it('create with assignee emits created and assigned', () => {
    const h = harness();
    const out = h.run({ type: 'create', taskId: 't1', by: 'lead', title: 'x', assignee: 'dev' });
    expect(out.map(e => e.type)).toEqual(['task.created', 'task.assigned']);
    expect(h.view()?.status).toBe('assigned');
  });

  it('supports blocked round trips', () => {
    const h = harness();
    h.run({ type: 'create', taskId: 't1', by: 'lead', title: 'x', assignee: 'dev' });
    h.run({ type: 'start', taskId: 't1', by: 'dev' });
    h.run({ type: 'block', taskId: 't1', by: 'dev', reason: 'waiting' });
    expect(h.view()).toMatchObject({ status: 'blocked', blockedReason: 'waiting' });
    h.run({ type: 'start', taskId: 't1', by: 'dev' });
    expect(h.view()?.status).toBe('in_progress');
    expect(h.view()?.blockedReason).toBeUndefined();
    h.run({ type: 'block', taskId: 't1', by: 'dev', reason: 'again' });
    h.run({ type: 'assign', taskId: 't1', by: 'lead', assignee: 'qa' });
    expect(h.view()).toMatchObject({ status: 'assigned', assignee: 'qa' });
  });

  it('cancels from any non-terminal state and then rejects everything', () => {
    for (const setup of [
      [],
      [{ type: 'assign', by: 'lead', assignee: 'dev' }],
      [{ type: 'assign', by: 'lead', assignee: 'dev' }, { type: 'start', by: 'dev' }],
      [{ type: 'assign', by: 'lead', assignee: 'dev' }, { type: 'start', by: 'dev' }, { type: 'block', by: 'dev', reason: 'r' }],
    ] as Array<Array<Record<string, string>>>) {
      const h = harness();
      h.run({ type: 'create', taskId: 't1', by: 'lead', title: 'x' });
      for (const step of setup) h.run({ taskId: 't1', ...step } as never);
      h.run({ type: 'cancel', taskId: 't1', by: 'anyone' });
      expect(h.view()?.status).toBe('cancelled');
      for (const type of ['assign', 'start', 'block', 'complete', 'cancel', 'handoff']) {
        expect(code(() => h.run({ type, taskId: 't1', by: 'dev', assignee: 'x', reason: 'r', result: 'r', to: 'z' } as never))).toBe('task_terminal');
      }
    }
  });

  it('rejects every illegal transition explicitly', () => {
    const h = harness();
    h.run({ type: 'create', taskId: 't1', by: 'lead', title: 'x' });
    expect(code(() => h.run({ type: 'create', taskId: 't1', by: 'lead', title: 'x' }))).toBe('task_exists');
    expect(code(() => h.run({ type: 'start', taskId: 't1', by: 'dev' }))).toBe('invalid_transition');
    expect(code(() => h.run({ type: 'start', taskId: 'nope', by: 'dev' }))).toBe('task_not_found');
    h.run({ type: 'assign', taskId: 't1', by: 'lead', assignee: 'dev' });
    expect(code(() => h.run({ type: 'start', taskId: 't1', by: 'other' }))).toBe('not_assignee');
    expect(code(() => h.run({ type: 'complete', taskId: 't1', by: 'dev', result: 'x' }))).toBe('invalid_transition');
    h.run({ type: 'start', taskId: 't1', by: 'dev' });
    expect(code(() => h.run({ type: 'complete', taskId: 't1', by: 'other', result: 'x' }))).toBe('not_assignee');
    expect(code(() => h.run({ type: 'complete', taskId: 't1', by: 'dev', result: '  ' }))).toBe('invalid_input');
    expect(code(() => h.run({ type: 'complete', taskId: 't1', by: 'dev', result: 'x'.repeat(8001) }))).toBe('invalid_input');
    expect(code(() => h.run({ type: 'block', taskId: 't1', by: 'dev', reason: '' }))).toBe('invalid_input');
    expect(code(() => h.run({ type: 'block', taskId: 't1', by: 'other', reason: 'r' }))).toBe('not_assignee');
    expect(code(() => h.run({ type: 'handoff', taskId: 't1', by: 'dev', to: 'dev' }))).toBe('invalid_input');
    expect(code(() => h.run({ type: 'handoff', taskId: 't1', by: 'other', to: 'qa' }))).toBe('not_assignee');
    expect(code(() => h.run({ type: 'assign', taskId: 't1', by: 'lead', assignee: 'qa' }))).toBe('invalid_transition');
    expect(h.events).toHaveLength(3);
  });

  it('handoff moves the assignee and returns to assigned', () => {
    const h = harness();
    h.run({ type: 'create', taskId: 't1', by: 'lead', title: 'x', assignee: 'dev' });
    h.run({ type: 'start', taskId: 't1', by: 'dev' });
    h.run({ type: 'handoff', taskId: 't1', by: 'dev', to: 'qa', note: 'please review' });
    expect(h.view()).toMatchObject({ status: 'assigned', assignee: 'qa', handoffCount: 1 });
    expect(code(() => h.run({ type: 'start', taskId: 't1', by: 'dev' }))).toBe('not_assignee');
    h.run({ type: 'start', taskId: 't1', by: 'qa' });
    h.run({ type: 'handoff', taskId: 't1', by: 'qa', to: 'dev' });
    expect(h.view()?.handoffCount).toBe(2);
  });

  it('is idempotent by commandId and detects conflicts', () => {
    const h = harness();
    const first = h.run({ type: 'create', taskId: 't1', by: 'lead', title: 'x', commandId: 'same' });
    expect(first).toHaveLength(1);
    expect(h.run({ type: 'create', taskId: 't1', by: 'lead', title: 'x', commandId: 'same' })).toEqual([]);
    expect(() => h.run({ type: 'create', taskId: 't1', by: 'lead', title: 'different', commandId: 'same' }))
      .toThrow(RoomTaskCommandConflictError);
    expect(h.events).toHaveLength(1);
  });

  it('rejects prototype-polluting and malformed task ids', () => {
    const h = harness();
    for (const taskId of ['__proto__', 'constructor', 'prototype', '', ' a', 'a b', 'x'.repeat(65)]) {
      expect(code(() => h.run({ type: 'create', taskId, by: 'lead', title: 'x' }))).toBe('invalid_input');
    }
    expect(({} as Record<string, unknown>).title).toBeUndefined();
  });

  it('freezes state and views', () => {
    const h = harness();
    h.run({ type: 'create', taskId: 't1', by: 'lead', title: 'x' });
    const state = replayRoomTasks(ROOM, h.events);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.tasks)).toBe(true);
    expect(Object.isFrozen(state.tasks.t1)).toBe(true);
    expect(Object.isFrozen(emptyRoomTaskState(ROOM))).toBe(true);
  });

  it('replay is deterministic and fails closed on bad streams', () => {
    const h = harness();
    h.run({ type: 'create', taskId: 't1', by: 'lead', title: 'x', assignee: 'dev' });
    h.run({ type: 'start', taskId: 't1', by: 'dev' });
    expect(replayRoomTasks(ROOM, h.events)).toEqual(replayRoomTasks(ROOM, [...h.events]));
    const [a, b, c] = h.events;
    const edit = (event: RoomTaskEvent, patch: Record<string, unknown>) => ({ ...event, ...patch }) as RoomTaskEvent;
    expect(() => replayRoomTasks(ROOM, [a, c])).toThrow(RoomTaskReplayError);
    expect(() => replayRoomTasks(ROOM, [b, c])).toThrow(RoomTaskReplayError);
    expect(() => replayRoomTasks(ROOM, [a, edit(b, { roomId: 'other' })])).toThrow(RoomTaskReplayError);
    expect(() => replayRoomTasks(ROOM, [a, edit(b, { version: 2 })])).toThrow(RoomTaskReplayError);
    expect(() => replayRoomTasks(ROOM, [a, edit(b, { eventId: a.eventId })])).toThrow(RoomTaskReplayError);
    expect(() => replayRoomTasks(ROOM, [a, edit(b, { extra: 1 })])).toThrow(RoomTaskReplayError);
    // illegal transition: started by a non-assignee
    expect(() => replayRoomTasks(ROOM, [a, b, edit(c, { by: 'intruder' })])).toThrow(RoomTaskReplayError);
    // complete straight from assigned
    expect(() => replayRoomTasks(ROOM, [a, edit(b, { type: 'task.completed', result: 'r', by: 'dev' })]))
      .toThrow(RoomTaskReplayError);
  });
});
