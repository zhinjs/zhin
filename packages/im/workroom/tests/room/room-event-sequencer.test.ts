import { createRoomEventSequencer } from '../../src/room/room-event-sequencer.js';
import { MemoryRoomTaskJournal } from '../../src/room/room-task-journal.js';
import { createRoomTaskService } from '../../src/room/room-task-service.js';
import type { RoomTaskEvent } from '../../src/room/room-task.js';

const ev = (roomId: string, sequence: number) => ({ roomId, sequence });
const seqs = (events: readonly { sequence: number }[]) => events.map((e) => e.sequence);

describe('createRoomEventSequencer', () => {
  it('releases in-order events immediately', () => {
    const s = createRoomEventSequencer();
    expect(seqs(s.accept(ev('r', 0)))).toEqual([0]);
    expect(seqs(s.accept(ev('r', 1)))).toEqual([1]);
    expect(s.watermark('r')).toBe(2);
  });

  it('buffers out-of-order events and releases the contiguous run', () => {
    const s = createRoomEventSequencer();
    expect(s.accept(ev('r', 2))).toEqual([]);
    expect(s.accept(ev('r', 1))).toEqual([]);
    expect(s.accept(ev('r', 4))).toEqual([]);
    expect(seqs(s.accept(ev('r', 0)))).toEqual([0, 1, 2]);
    expect(s.watermark('r')).toBe(3);
    expect(seqs(s.accept(ev('r', 3)))).toEqual([3, 4]);
  });

  it('drops duplicates (released or buffered) and stale events', () => {
    const s = createRoomEventSequencer();
    s.accept(ev('r', 0));
    expect(s.accept(ev('r', 0))).toEqual([]);
    s.accept(ev('r', 2));
    expect(s.accept(ev('r', 2))).toEqual([]);
    expect(seqs(s.accept(ev('r', 1)))).toEqual([1, 2]);
    expect(s.accept(ev('r', 1))).toEqual([]);
  });

  it('keeps one watermark per Room and supports reset', () => {
    const s = createRoomEventSequencer();
    s.accept(ev('a', 0));
    s.accept(ev('a', 1));
    expect(s.watermark('a')).toBe(2);
    expect(s.watermark('b')).toBe(0);
    expect(seqs(s.accept(ev('b', 0)))).toEqual([0]);
    s.reset('a');
    expect(s.watermark('a')).toBe(0);
    expect(s.watermark('b')).toBe(1);
    s.reset();
    expect(s.watermark('b')).toBe(0);
  });

  it('honours startAt', () => {
    const s = createRoomEventSequencer({ startAt: 5 });
    expect(s.accept(ev('r', 3))).toEqual([]);
    expect(s.accept(ev('r', 6))).toEqual([]);
    expect(seqs(s.accept(ev('r', 5)))).toEqual([5, 6]);
    expect(() => createRoomEventSequencer({ startAt: -1 })).toThrow(RangeError);
  });

  it('fails closed on overflow and invalid sequences', () => {
    const s = createRoomEventSequencer({ maxBuffered: 2 });
    s.accept(ev('r', 3));
    s.accept(ev('r', 4));
    expect(() => s.accept(ev('r', 5))).toThrow(RangeError);
    for (const bad of [-1, 1.5, Number.NaN, Infinity]) expect(() => s.accept(ev('r', bad))).toThrow(TypeError);
    expect(() => s.accept(ev('r', '1' as never))).toThrow(TypeError);
  });

  it('orders interleaved subscriber dispatch of concurrent executes and drops replays', async () => {
    let ids = 0;
    const service = createRoomTaskService({ journal: new MemoryRoomTaskJournal(), newId: () => `e${ids++}`, now: () => 1 });
    const sequencer = createRoomEventSequencer<RoomTaskEvent>();
    const raw: RoomTaskEvent[] = [];
    const released: RoomTaskEvent[] = [];
    service.subscribe((event) => {
      raw.push(event);
      released.push(...sequencer.accept(event));
    });
    const commands = Array.from({ length: 8 }, (_, i) => ({
      type: 'create' as const, commandId: `c${i}`, taskId: `t${i}`, by: 'dev', title: 'x', assignee: 'dev',
    }));
    await Promise.all(commands.map((c) => service.execute('r', c)));
    // idempotent replays of the same commandIds produce no new events
    await Promise.all(commands.map((c) => service.execute('r', c)));
    expect(raw).toHaveLength(16);
    const range16 = Array.from({ length: 16 }, (_, i) => i);
    // every sequence 0..15 appears exactly once in the raw dispatch
    expect([...seqs(raw)].sort((a, b) => a - b)).toEqual(range16);
    // dispatch order cannot be forced, so also prove ordering on a deterministic permutation (reversed in pairs)
    const shuffled = raw.flatMap((_, i) => (i % 2 === 0 ? [raw[i + 1]!, raw[i]!] : []));
    expect(seqs(shuffled)).not.toEqual(range16);
    const fresh = createRoomEventSequencer<RoomTaskEvent>();
    expect(seqs(shuffled.flatMap((event) => fresh.accept(event)))).toEqual(range16);
    expect(seqs(released)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    // feeding the same events again, in any order, releases nothing
    for (const event of [...raw].reverse()) expect(sequencer.accept(event)).toEqual([]);
    expect(sequencer.watermark('r')).toBe(16);
  });
});
