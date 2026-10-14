import { describe, expect, it } from 'vitest';
import { ExplorationBudget, EXPLORATION_GUIDANCE } from '../../src/core/exploration-budget.js';
import { resolveModelHarness } from '../../src/config/model-harness-runtime.js';

describe('ExplorationBudget', () => {
  it('nudges after N consecutive read-only exploration calls and again at each multiple', () => {
    const budget = new ExplorationBudget(3);
    expect(budget.record('grep')).toBeUndefined();
    expect(budget.record('read_file')).toBeUndefined();
    expect(budget.record('glob')).toMatch(/^\[Harness note\] 3 read-only exploration calls in a row/);
    expect(budget.record('list_dir')).toBeUndefined();
    expect(budget.record('read_file')).toBeUndefined();
    expect(budget.record('grep')).toMatch(/6 read-only exploration calls/);
  });

  it('resets when the model acts with a non-exploration tool', () => {
    const budget = new ExplorationBudget(2);
    expect(budget.record('grep')).toBeUndefined();
    expect(budget.record('edit_file')).toBeUndefined();
    expect(budget.record('grep')).toBeUndefined();
    expect(budget.record('read_file')).toMatch(/Harness note/);
  });

  it('is disabled by a zero or invalid budget', () => {
    for (const value of [0, -1, Number.NaN]) {
      const budget = new ExplorationBudget(value);
      for (let index = 0; index < 20; index += 1) expect(budget.record('grep')).toBeUndefined();
    }
  });

  it('guidance tells the model to plan and scope before exploring', () => {
    expect(EXPLORATION_GUIDANCE).toMatch(/scope every search/);
    expect(EXPLORATION_GUIDANCE).toMatch(/propose a plan/);
  });
});

describe('minimax model harness preset', () => {
  it('applies to direct and routed MiniMax M-series models', () => {
    for (const [provider, model] of [['minimax', 'minimax-m3'], ['openrouter', 'minimax/minimax-m3'], ['minimax', 'MiniMax-M2']]) {
      expect(resolveModelHarness(provider!, model!)).toEqual({ explorationBudget: 5, explorationGuidance: true });
    }
    expect(resolveModelHarness('minimax', 'abab6.5s-chat')).toEqual({});
  });

  it('keeps the configured iteration budget and lets config override the preset', () => {
    expect(resolveModelHarness('minimax', 'minimax-m3').maxIterations).toBeUndefined();
    expect(resolveModelHarness('minimax', 'minimax-m3', {
      models: { 'minimax:minimax-m3': { explorationBudget: 0, explorationGuidance: false, maxIterations: 20 } },
    })).toEqual({ maxIterations: 20, explorationBudget: 0, explorationGuidance: false });
  });
});
