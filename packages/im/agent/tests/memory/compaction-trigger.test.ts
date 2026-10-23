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

  it('does not raise the trigger above the available budget to fit retention', () => {
    expect(resolveCompactionTriggerTokens({ keepRecentTokens: 20_000 }, 32_000, 10_000)).toBe(9_000);
  });
});

it.each([8_192, 16_384])('uses the available message budget in a %i-token window', (window) => {
  const trigger = resolveCompactionTriggerTokens(undefined, window, 1_000);
  expect(trigger).toBeLessThanOrEqual(Math.floor(window * 0.7) - 1_000);
  expect(trigger).toBeGreaterThanOrEqual(0);
});

it('never returns a negative budget when fixed instructions consume the window', () => {
  expect(resolveCompactionTriggerTokens(undefined, 8_192, 9_000)).toBe(0);
});
