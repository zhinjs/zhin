import { describe, it, expect } from 'vitest';
import {
  parseKl8GroupStrategy,
  recommendKl8Groups,
  resolveKl8Config,
  weightsForKl8Strategy,
} from '../../src/games/kl8-groups.js';
import { DEFAULT_WEIGHTS, type NormalizedDraw } from '../../src/types.js';

function kl8Draw(issue: string, main: number[]): NormalizedDraw {
  return { gameId: 'kl8', issue, drawTime: '2024-01-01', numbers: { main }, source: 'fucai' };
}

describe('resolveKl8Config', () => {
  it('defaults to 3 groups with balanced/hot/cold', () => {
    const cfg = resolveKl8Config(5);
    expect(cfg.pickCount).toBe(5);
    expect(cfg.recommendGroups).toBe(3);
    expect(cfg.groupStrategies).toEqual(['balanced', 'hot', 'cold']);
  });

  it('clamps groups and parses strategies', () => {
    const cfg = resolveKl8Config(5, {
      recommendGroups: 12,
      groupStrategies: ['hot', 'unknown', 'trend'],
    });
    expect(cfg.recommendGroups).toBe(10);
    expect(cfg.groupStrategies).toEqual(['hot', 'balanced', 'trend']);
  });
});

describe('parseKl8GroupStrategy', () => {
  it('falls back unknown to balanced', () => {
    expect(parseKl8GroupStrategy('foo')).toBe('balanced');
    expect(parseKl8GroupStrategy('HOT')).toBe('hot');
  });
});

describe('recommendKl8Groups', () => {
  const draws = Array.from({ length: 40 }, (_, i) =>
    kl8Draw(String(i + 1), Array.from({ length: 20 }, (_, j) => ((i * 3 + j * 7) % 80) + 1)),
  );

  it('returns N groups with pickCount numbers each', () => {
    const { groups } = recommendKl8Groups(draws, {
      pickCount: 5,
      recommendGroups: 3,
      strategies: ['balanced', 'hot', 'cold'],
      tieSeed: '2026-07-11',
      baseWeights: DEFAULT_WEIGHTS,
    });
    expect(groups).toHaveLength(3);
    for (const g of groups) {
      expect(g.numbers).toHaveLength(5);
      expect(new Set(g.numbers).size).toBe(5);
    }
    expect(groups[0]!.strategy).toBe('balanced');
    expect(groups[1]!.strategy).toBe('hot');
    expect(groups[2]!.strategy).toBe('cold');
  });

  it('uses base weights for balanced strategy', () => {
    const base = { freq: 0.33, omit: 0.33, trend: 0.34 };
    expect(weightsForKl8Strategy('balanced', base)).toEqual(base);
    expect(weightsForKl8Strategy('hot', base).freq).toBeGreaterThan(0.5);
  });
});
