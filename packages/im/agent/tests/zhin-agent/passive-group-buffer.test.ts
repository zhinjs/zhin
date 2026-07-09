import { describe, expect, it } from 'vitest';
import {
  MAX_PASSIVE_LINES,
  PASSIVE_TTL_MS,
  prunePassiveLines,
  pushPassiveGroupLine,
  peekPassiveGroupBuffer,
  drainPassiveGroupBuffer,
} from '../../src/zhin-agent/passive-group-buffer.js';

describe('passive-group-buffer cap/TTL', () => {
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
});
