import { describe, it, expect } from 'vitest';
import {
  COLLABORATION_CONTEXT_TAIL_MESSAGE_LIMIT,
  resolveContextTailMessageLimit,
  DEFAULT_CONTEXT_TAIL_MESSAGE_LIMIT,
} from '../../src/zhin-agent/context-tail-limit.js';

describe('resolveContextTailMessageLimit', () => {
  it('uses explicit contextTailMessageLimit when set', () => {
    expect(resolveContextTailMessageLimit({ contextTailMessageLimit: 200, slidingWindowSize: 5 })).toBe(200);
  });

  it('defaults to at least 80 when only slidingWindowSize=5 (legacy misuse)', () => {
    expect(resolveContextTailMessageLimit({ slidingWindowSize: 5 })).toBe(DEFAULT_CONTEXT_TAIL_MESSAGE_LIMIT);
  });

  it('respects slidingWindowSize when larger than default floor', () => {
    expect(resolveContextTailMessageLimit({ slidingWindowSize: 100 })).toBe(100);
  });

  it('collaboration default tail is modest for multi-bot groups', () => {
    expect(COLLABORATION_CONTEXT_TAIL_MESSAGE_LIMIT).toBeLessThanOrEqual(40);
  });
});
