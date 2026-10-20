import { describe, it, expect } from 'vitest';
import { planRecommendWeights, gamesToPredict } from '../../src/evaluate/weight-guard.js';
import { DEFAULT_WEIGHTS } from '../../src/types.js';
import type { SimulationResult } from '../../src/evaluate/adaptive-sim.js';

function summary(gameId: SimulationResult['gameId'], delta: number): SimulationResult {
  return {
    gameId,
    periods: 10,
    warmupPeriods: 0,
    adaptiveAvgHitRate: 0.2,
    fixedAvgHitRate: 0.2,
    randomAvgHitRate: 0.2,
    adaptiveVsRandom: delta,
    adaptiveVsFixed: 0,
    initialWeights: DEFAULT_WEIGHTS,
    finalWeights: DEFAULT_WEIGHTS,
    firstScoredIssue: '1',
    lastScoredIssue: '10',
  };
}

describe('gamesToPredict', () => {
  it('includes missing games and holdout-fallback regen', () => {
    const plan = planRecommendWeights(
      ['kl8', 'ssq', 'dlt'],
      [summary('kl8', -0.05), summary('fc3d', -0.01)],
      true,
    );
    expect(gamesToPredict(['kl8', 'ssq', 'dlt'], ['ssq'], plan)).toEqual(['kl8', 'ssq']);
  });
});

describe('planRecommendWeights', () => {
  it('falls back to DEFAULT when holdout loses to random', () => {
    const plan = planRecommendWeights(
      ['kl8', 'dlt'],
      [summary('kl8', -0.05), summary('dlt', 0.03)],
      true,
    );
    expect(plan.fallbacks).toEqual(['kl8']);
    expect(plan.overrides.get('kl8')).toEqual(DEFAULT_WEIGHTS);
    expect(plan.overrides.has('dlt')).toBe(false);
  });

  it('skips fallback when disabled', () => {
    const plan = planRecommendWeights(['kl8'], [summary('kl8', -0.1)], false);
    expect(plan.fallbacks).toEqual([]);
    expect(plan.overrides.size).toBe(0);
  });
});
