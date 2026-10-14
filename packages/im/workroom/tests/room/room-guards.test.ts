import { createRoomGuards, countPairHandoffs, RoomGuardRejectedError } from '../../src/room/room-guards.js';
import type { RoomTaskEvent } from '../../src/room/room-task.js';

const handoff = (seq: number, from: string, to: string, taskId = 't'): RoomTaskEvent => ({
  version: 1, roomId: 'r', sequence: seq, eventId: `e${seq}`, at: seq, taskId, commandId: `c${seq}`, commandDigest: 'd',
  type: 'task.handoff', from, to,
});

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const tick = () => new Promise<void>((r) => setImmediate(r));

describe('room guards: handoff', () => {
  const base = { roomId: 'r', taskId: 't', from: 'a', to: 'b' };

  it('rejects at the depth limit and escalates to a human', () => {
    const guards = createRoomGuards({ maxHandoffDepth: 3 });
    expect(guards.checkHandoff({ ...base, handoffCount: 2 })).toEqual({ allowed: true });
    const refused = guards.checkHandoff({ ...base, handoffCount: 3 });
    expect(refused).toMatchObject({ allowed: false, code: 'handoff_depth', escalateToHuman: true });
    expect((refused as { reason: string }).reason).toContain('3');
  });

  it('rejects ping-pong from journal history, counting both directions of the same pair only', () => {
    const guards = createRoomGuards({ maxPingPong: 3 });
    const history = [handoff(0, 'a', 'b'), handoff(1, 'b', 'a'), handoff(2, 'a', 'b')];
    expect(guards.checkHandoff({ ...base, handoffCount: 3, history })).toMatchObject({ allowed: false, code: 'ping_pong', escalateToHuman: true });
    expect(guards.checkHandoff({ ...base, handoffCount: 2, history: history.slice(0, 2) })).toEqual({ allowed: true });
    const chain = [handoff(0, 'a', 'b'), handoff(1, 'b', 'c'), handoff(2, 'a', 'b')];
    expect(countPairHandoffs(chain, 't', 'a', 'b')).toBe(2);
    expect(countPairHandoffs(chain, 't', 'b', 'c')).toBe(1);
    expect(guards.checkHandoff({ ...base, taskId: 'other', handoffCount: 0, history })).toEqual({ allowed: true });
  });

  it('only checks depth without history', () => {
    expect(createRoomGuards().checkHandoff({ ...base, handoffCount: 0 })).toEqual({ allowed: true });
  });

  it('fails closed on malformed input or history', () => {
    const logs: string[] = [];
    const guards = createRoomGuards({ logger: { warn: (m) => logs.push(m) } });
    const poisoned = [{ get type(): string { throw new Error('boom'); } }] as unknown as RoomTaskEvent[];
    expect(guards.checkHandoff({ ...base, handoffCount: 0, history: poisoned })).toMatchObject({ allowed: false, code: 'guard_error', escalateToHuman: true });
    expect(guards.checkHandoff({ ...base, handoffCount: Number.NaN })).toMatchObject({ allowed: false, code: 'guard_error' });
    expect(guards.checkHandoff({ ...base, from: '', handoffCount: 0 })).toMatchObject({ allowed: false, code: 'guard_error' });
    expect(logs.length).toBe(3);
  });
});

describe('room guards: turn rate', () => {
  it('limits turns per sliding minute and reports retryAfterMs', () => {
    const c = clock();
    const guards = createRoomGuards({ now: c.now, maxTurnsPerMinute: 2 });
    expect(guards.admitTurn('r')).toEqual({ allowed: true });
    c.advance(10_000);
    expect(guards.admitTurn('r')).toEqual({ allowed: true });
    c.advance(5_000);
    expect(guards.admitTurn('r')).toEqual({ allowed: false, code: 'turn_rate', retryAfterMs: 45_000 });
    // rejected turns do not occupy the window
    c.advance(45_000);
    expect(guards.admitTurn('r')).toEqual({ allowed: true });
    expect(guards.admitTurn('r')).toEqual({ allowed: false, code: 'turn_rate', retryAfterMs: 10_000 });
    c.advance(60_000);
    expect(guards.admitTurn('r')).toEqual({ allowed: true });
  });

  it('keeps rooms independent', () => {
    const c = clock();
    const guards = createRoomGuards({ now: c.now, maxTurnsPerMinute: 1 });
    expect(guards.admitTurn('a').allowed).toBe(true);
    expect(guards.admitTurn('b').allowed).toBe(true);
    expect(guards.admitTurn('a').allowed).toBe(false);
    expect(guards.stats().rateWindows).toBe(2);
  });

  it('fails closed when the clock is broken', () => {
    const guards = createRoomGuards({ now: () => Number.NaN });
    expect(guards.admitTurn('r')).toMatchObject({ allowed: false, code: 'turn_rate' });
  });
});

describe('room guards: exclusive turns', () => {
  it('serializes within a room and runs rooms in parallel', async () => {
    const guards = createRoomGuards();
    const order: string[] = [];
    const gate = deferred();
    const first = guards.runExclusive('r', async () => { order.push('1:start'); await gate.promise; order.push('1:end'); return 1; });
    const second = guards.runExclusive('r', async () => { order.push('2:start'); return 2; });
    const other = guards.runExclusive('s', async () => { order.push('s'); return 's'; });
    await tick();
    expect(order).toEqual(['1:start', 's']);
    gate.resolve();
    expect(await Promise.all([first, second, other])).toEqual([1, 2, 's']);
    expect(order).toEqual(['1:start', 's', '1:end', '2:start']);
  });

  it('keeps going after a failed turn and empties its state', async () => {
    const guards = createRoomGuards();
    const failing = guards.runExclusive('r', async () => { throw new Error('bad'); });
    const next = guards.runExclusive('r', async () => 'ok');
    await expect(failing).rejects.toThrow('bad');
    expect(await next).toBe('ok');
    await tick();
    expect(guards.stats().lanes).toBe(0);
  });

  it('rejects when the rate window is full, with retryAfterMs', async () => {
    const c = clock();
    const guards = createRoomGuards({ now: c.now, maxTurnsPerMinute: 1 });
    await guards.runExclusive('r', async () => 1);
    const error = await guards.runExclusive('r', async () => 2).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RoomGuardRejectedError);
    expect(error).toMatchObject({ code: 'turn_rate', retryAfterMs: 60_000 });
  });

  it('rejects when the queue is full', async () => {
    const guards = createRoomGuards({ maxQueuedTurns: 1 });
    const gate = deferred();
    const running = guards.runExclusive('r', () => gate.promise);
    await tick();
    const queued = guards.runExclusive('r', async () => 'q');
    await expect(guards.runExclusive('r', async () => 'x')).rejects.toMatchObject({ code: 'queue_full' });
    gate.resolve();
    await running;
    expect(await queued).toBe('q');
  });
});

describe('room guards: human cancel', () => {
  it('aborts the running turn and rejects queued ones for a human', async () => {
    const guards = createRoomGuards();
    const gate = deferred();
    let signal!: AbortSignal;
    const ran: string[] = [];
    const running = guards.runExclusive('r', async (s) => { signal = s; await gate.promise; return 'done'; });
    const queued = guards.runExclusive('r', async () => { ran.push('queued'); });
    const settled = queued.catch((e: unknown) => e);
    await tick();
    expect(signal.aborted).toBe(false);
    expect(guards.cancelRoom('r', { origin: 'human', accountId: 'u1' })).toEqual({ cancelledRunning: true, cancelledQueued: 1 });
    expect(signal.aborted).toBe(true);
    expect(await settled).toMatchObject({ code: 'cancelled' });
    gate.resolve();
    expect(await running).toBe('done');
    await tick();
    expect(ran).toEqual([]);
    expect(guards.stats().lanes).toBe(0);
  });

  it('refuses non-humans and leaves the turn alone', async () => {
    const guards = createRoomGuards();
    const gate = deferred();
    let signal!: AbortSignal;
    const running = guards.runExclusive('r', async (s) => { signal = s; await gate.promise; });
    await tick();
    for (const origin of ['member', 'peer_bot', 'self'] as const) {
      expect(() => guards.cancelRoom('r', { origin, accountId: 'x' })).toThrow(RoomGuardRejectedError);
    }
    expect(signal.aborted).toBe(false);
    gate.resolve();
    await running;
  });

  it('reports nothing cancelled when no turn is running', () => {
    expect(createRoomGuards().cancelRoom('r', { origin: 'human' })).toEqual({ cancelledRunning: false, cancelledQueued: 0 });
  });
});

describe('room guards: sensitive operations', () => {
  const guards = createRoomGuards({ sensitiveAccounts: [' owner '] });

  it('allows only configured human accounts', () => {
    expect(guards.authorizeSensitive('task.cancel', { origin: 'human', accountId: 'owner' })).toBeUndefined();
    expect(guards.authorizeSensitive('role.change', { origin: 'human', accountId: ' owner ' })).toBeUndefined();
    expect(guards.authorizeSensitive('task.cancel', { origin: 'human', accountId: 'Owner' })).toEqual(expect.any(String));
    expect(guards.authorizeSensitive('task.cancel', { origin: 'human', accountId: 'other' })).toEqual(expect.any(String));
    expect(guards.authorizeSensitive('task.cancel', { origin: 'member', accountId: 'owner' })).toEqual(expect.any(String));
    expect(guards.authorizeSensitive('task.cancel', { origin: 'human' })).toEqual(expect.any(String));
    expect(guards.authorizeSensitive('task.cancel', undefined)).toEqual(expect.any(String));
  });

  it('denies everything when no accounts are configured', () => {
    for (const g of [createRoomGuards(), createRoomGuards({ sensitiveAccounts: [] })]) {
      expect(g.authorizeSensitive('task.cancel', { origin: 'human', accountId: 'owner' })).toEqual(expect.any(String));
    }
  });

  it('rejects invalid numeric options at construction', () => {
    for (const bad of [-1, 0, Number.NaN, 1.5]) {
      for (const key of ['maxHandoffDepth', 'maxPingPong', 'maxTurnsPerMinute', 'maxQueuedTurns'] as const) {
        expect(() => createRoomGuards({ [key]: bad })).toThrow(RangeError);
      }
    }
  });
});
