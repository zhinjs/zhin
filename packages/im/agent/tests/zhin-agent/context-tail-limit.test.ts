import { describe, it, expect } from 'vitest';
import {
  resolveContextTailMessageLimit,
  DEFAULT_CONTEXT_TAIL_MESSAGE_LIMIT,
} from '../../src/context/context-tail-limit.js';

describe('resolveContextTailMessageLimit', () => {
  it('uses explicit contextTailMessageLimit when set', () => {
    expect(resolveContextTailMessageLimit({ contextTailMessageLimit: 200 })).toBe(200);
  });

  it('uses the canonical default when the explicit limit is absent', () => {
    expect(resolveContextTailMessageLimit({})).toBe(DEFAULT_CONTEXT_TAIL_MESSAGE_LIMIT);
  });
});
