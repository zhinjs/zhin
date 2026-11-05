import { describe, expect, it } from 'vitest';
import {
  AgentCompactionRuntime,
  resolveCompactionTriggerTokens,
  resolveUnifiedHistoryAndCompactionBudget,
} from '../../src/memory/compaction-runtime.js';

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

describe('resolveUnifiedHistoryAndCompactionBudget', () => {
  it('caps triggerTokens at windowTokens and keepRecentTokens at 75% of windowTokens', () => {
    const budget = resolveUnifiedHistoryAndCompactionBudget({
      windowTokens: 8_000,
      windowMessages: 20,
      triggerTokens: 20_000,
      keepRecentTokens: 15_000,
      triggerMessages: 50,
      keepRecentMessages: 30,
    });
    expect(budget).toEqual({
      windowTokens: 8_000,
      windowMessages: 20,
      effectiveTriggerTokens: 8_000,
      effectiveKeepRecentTokens: 6_000,
      effectiveTriggerMessages: 20,
      effectiveKeepRecentMessages: 15,
    });
  });

  it('derives sensible defaults when only windowTokens and windowMessages are given', () => {
    const runtime = new AgentCompactionRuntime({ historyWindowTokens: 10_000, historyWindowMessages: 24 });
    const aligned = runtime.alignWithHistoryWindow({ maxTokens: 10_000, maxMessages: 24, triggerMessages: 20 });
    expect(aligned.windowTokens).toBe(10_000);
    expect(aligned.windowMessages).toBe(24);
    expect(aligned.effectiveTriggerTokens).toBe(8_500);
    expect(aligned.effectiveKeepRecentTokens).toBe(4_250);
    expect(aligned.effectiveTriggerMessages).toBe(20);
    expect(aligned.effectiveKeepRecentMessages).toBe(12);
  });
});
