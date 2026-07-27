import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_PASSIVE_LINES,
  PASSIVE_TTL_MS,
  prunePassiveLines,
  pushPassiveGroupLine,
  peekPassiveGroupBuffer,
  drainPassiveGroupBuffer,
} from '../../src/session/passive-group-buffer.js';

describe('passive-group-buffer cap/TTL', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it('prunePassiveLines drops expired lines', () => {
    const now = Date.now();
    const pruned = prunePassiveLines([
      { senderId: 'a', text: 'old', at: now - PASSIVE_TTL_MS - 1 },
      { senderId: 'b', text: 'fresh', at: now },
    ]);
    expect(pruned).toHaveLength(1);
    expect(pruned[0]?.senderId).toBe('b');
  });

  it('prunePassiveLines keeps only the newest MAX_PASSIVE_LINES', () => {
    const now = Date.now();
    const lines = Array.from({ length: MAX_PASSIVE_LINES + 5 }, (_, i) => ({
      senderId: `u${i}`,
      text: `line ${i}`,
      at: now + i,
    }));
    const pruned = prunePassiveLines(lines);
    expect(pruned).toHaveLength(MAX_PASSIVE_LINES);
    expect(pruned[0]?.senderId).toBe('u5');
  });

  it('pushPassiveGroupLine applies prune on write', () => {
    const key = 'test-session-cap';
    const now = Date.now();
    for (let i = 0; i < MAX_PASSIVE_LINES + 1; i++) {
      pushPassiveGroupLine(key, { senderId: `u${i}`, text: `t${i}`, at: now + i });
    }
    expect(peekPassiveGroupBuffer(key)).toHaveLength(MAX_PASSIVE_LINES);
    const drained = drainPassiveGroupBuffer(key);
    expect(drained[0]?.senderId).toBe('u1');
  });

  it('push sweeps dead session keys whose lines all expired', () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    vi.setSystemTime(t0);
    pushPassiveGroupLine('dead-session', { senderId: 'u1', text: 'old', at: t0 });
    expect(peekPassiveGroupBuffer('dead-session')).toHaveLength(1);

    // 死 session 不再被 @：整体过期后，其他 session 的下一次 push 顺手清掉它
    vi.setSystemTime(t0 + PASSIVE_TTL_MS + 1);
    pushPassiveGroupLine('live-session', { senderId: 'u2', text: 'new', at: Date.now() });

    expect(peekPassiveGroupBuffer('dead-session')).toHaveLength(0);
    expect(peekPassiveGroupBuffer('live-session')).toHaveLength(1);
  });

  it('push of an already-expired line into a fresh key does not retain it', () => {
    const now = Date.now();
    pushPassiveGroupLine('expired-session', {
      senderId: 'u1',
      text: 'stale',
      at: now - PASSIVE_TTL_MS - 1,
    });
    expect(peekPassiveGroupBuffer('expired-session')).toHaveLength(0);
  });
});
