/**
 * Per-Room ordering / de-duplication of sequenced events (pure, no IO).
 *
 * RoomTaskService dispatches subscribers outside the Room serial section, so events of one Room may arrive
 * interleaved or out of order. `accept` releases events strictly in `sequence` order: a duplicate or stale
 * event is dropped, a future one is buffered until the gap is filled.
 */

export interface RoomEventSequencerOptions {
  /** First expected sequence per Room (default 0: journal sequences are contiguous from 0). */
  readonly startAt?: number;
  /** Maximum buffered (out-of-order) events per Room; exceeding it throws RangeError (fail-closed). Default 1024. */
  readonly maxBuffered?: number;
}

export interface RoomEventSequencer<T extends { roomId: string; sequence: number }> {
  /** Events now releasable in order: [] for a duplicate / stale / buffered event. */
  accept(event: T): T[];
  /** Next expected sequence of the Room. */
  watermark(roomId: string): number;
  /** Forgets one Room (or all); buffered events are discarded. */
  reset(roomId?: string): void;
}

interface RoomCursor<T> {
  next: number;
  readonly buffer: Map<number, T>;
}

export function createRoomEventSequencer<T extends { roomId: string; sequence: number }>(
  options: RoomEventSequencerOptions = {},
): RoomEventSequencer<T> {
  const startAt = options.startAt ?? 0;
  const maxBuffered = options.maxBuffered ?? 1024;
  if (!Number.isSafeInteger(startAt) || startAt < 0) throw new RangeError('startAt must be a non-negative integer');
  if (!Number.isSafeInteger(maxBuffered) || maxBuffered < 0) throw new RangeError('maxBuffered must be a non-negative integer');
  const cursors = new Map<string, RoomCursor<T>>();
  const cursorOf = (roomId: string): RoomCursor<T> => {
    let cursor = cursors.get(roomId);
    if (!cursor) {
      cursor = { next: startAt, buffer: new Map() };
      cursors.set(roomId, cursor);
    }
    return cursor;
  };

  return {
    accept(event) {
      if (!Number.isSafeInteger(event.sequence) || event.sequence < 0) {
        throw new TypeError(`event sequence must be a non-negative integer, got ${String(event.sequence)}`);
      }
      const cursor = cursorOf(event.roomId);
      if (event.sequence < cursor.next || cursor.buffer.has(event.sequence)) return [];
      if (event.sequence > cursor.next) {
        if (cursor.buffer.size >= maxBuffered) {
          throw new RangeError(`room ${event.roomId} has more than ${maxBuffered} out-of-order events buffered`);
        }
        cursor.buffer.set(event.sequence, event);
        return [];
      }
      const released: T[] = [event];
      cursor.next += 1;
      for (let held = cursor.buffer.get(cursor.next); held !== undefined; held = cursor.buffer.get(cursor.next)) {
        cursor.buffer.delete(cursor.next);
        released.push(held);
        cursor.next += 1;
      }
      return released;
    },
    watermark: (roomId) => cursors.get(roomId)?.next ?? startAt,
    reset(roomId) {
      if (roomId === undefined) cursors.clear();
      else cursors.delete(roomId);
    },
  };
}
