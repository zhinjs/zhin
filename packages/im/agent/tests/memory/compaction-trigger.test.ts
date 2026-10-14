import { describe, expect, it } from 'vitest';
import { resolveCompactionTriggerTokens } from '../../src/memory/compaction-runtime.js';

describe('resolveCompactionTriggerTokens', () => {
  it('triggers at 70% of the window minus the fixed prompt by default', () => {
    expect(resolveCompactionTriggerTokens(undefined, 128_000, 4_000)).toBe(85_600);
  });

  it('honours thresholdRatio', () => {
    expect(resolveCompactionTriggerTokens({ thresholdRatio: 0.5 }, 100_000)).toBe(50_000);
  });

  it('never exceeds the window minus the safety buffer', () => {
    expect(resolveCompactionTriggerTokens({ thresholdRatio: 1 }, 100_000)).toBe(87_000);
  });

  it('never drops below 1.25 × keepRecentTokens', () => {
    expect(resolveCompactionTriggerTokens({ keepRecentTokens: 20_000 }, 32_000, 10_000)).toBe(25_000);
  });
});
