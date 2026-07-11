import { describe, it, expect } from 'vitest';
import { scorePool, scoreDigits, pickTopUnique } from '../../src/stats/engine.js';
import { recommendGame } from '../../src/recommend/game-pick.js';
import type { NormalizedDraw } from '../../src/types.js';

function kl8Draw(issue: string, main: number[]): NormalizedDraw {
  return { gameId: 'kl8', issue, drawTime: '2024-01-01', numbers: { main }, source: 'fucai' };
}

function ssqDraw(issue: string, red: number[], blue: number[]): NormalizedDraw {
  return { gameId: 'ssq', issue, drawTime: '2024-01-01', numbers: { red, blue }, source: 'fucai' };
}

describe('stats engine', () => {
  it('scores pool and picks unique numbers', () => {
    const draws = [
      [1, 2, 3, 4, 5],
      [1, 2, 6, 7, 8],
      [9, 10, 11, 12, 13],
    ];
    const scores = scorePool(draws, 1, 20, 'seed');
    expect(scores.length).toBe(20);
    const pick = pickTopUnique(scores, 5);
    expect(pick).toHaveLength(5);
    expect(new Set(pick).size).toBe(5);
  });

  it('scores digit positions independently', () => {
    const draws = [
      [1, 2, 3],
      [1, 5, 3],
      [4, 2, 8],
    ];
    const digits = scoreDigits(draws, 3, 'seed');
    expect(digits).toHaveLength(3);
    digits.forEach((d) => expect(d).toBeGreaterThanOrEqual(0));
  });
});

describe('recommendGame structures', () => {
  it('kl8 returns pickCount numbers', () => {
    const draws = [kl8Draw('1', [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 2, 3, 4, 6])];
    const pick = recommendGame('kl8', draws, { pickCount: 5, tieSeed: '2026-07-11' });
    expect(pick.numbers.main).toHaveLength(5);
  });

  it('kl8 multi-group when recommendGroups > 1', () => {
    const draws = Array.from({ length: 30 }, (_, i) =>
      kl8Draw(String(i), Array.from({ length: 20 }, (_, j) => ((i + j) % 80) + 1)),
    );
    const pick = recommendGame('kl8', draws, {
      pickCount: 5,
      tieSeed: '2026-07-11',
      kl8: { pickCount: 5, recommendGroups: 3, groupStrategies: ['balanced', 'hot', 'cold'] },
    });
    expect(pick.kl8Groups).toHaveLength(3);
    expect(pick.label).toContain('3组');
  });

  it('ssq returns 6 red + 1 blue', () => {
    const draws = [ssqDraw('1', [1, 2, 3, 4, 5, 6], [7])];
    const pick = recommendGame('ssq', draws, { pickCount: 5, tieSeed: 'x' });
    expect(pick.numbers.red).toHaveLength(6);
    expect(pick.numbers.blue).toHaveLength(1);
  });

  it('dlt returns 5 front + 2 back', () => {
    const draws = [{
      gameId: 'dlt' as const,
      issue: '1',
      drawTime: '',
      numbers: { front: [1, 2, 3, 4, 5], back: [1, 2] },
      source: 'ticai' as const,
    }];
    const pick = recommendGame('dlt', draws, { pickCount: 5, tieSeed: 'x' });
    expect(pick.numbers.front).toHaveLength(5);
    expect(pick.numbers.back).toHaveLength(2);
  });

  it('fc3d returns 3 digits', () => {
    const draws = [{
      gameId: 'fc3d' as const,
      issue: '1',
      drawTime: '',
      numbers: { digits: [3, 8, 1] },
      source: 'fucai' as const,
    }];
    const pick = recommendGame('fc3d', draws, { pickCount: 5, tieSeed: 'x' });
    expect(pick.numbers.digits).toHaveLength(3);
  });
});
