import { describe, it, expect } from 'vitest';
import { comparePickToDraw, tuneWeightsFromDraw } from '../../src/evaluate/hit-rate.js';
import { DEFAULT_WEIGHTS, type GamePick, type NormalizedDraw } from '../../src/types.js';

function pick(gameId: GamePick['gameId'], numbers: GamePick['numbers']): GamePick {
  return {
    gameId,
    label: gameId,
    numbers,
    weights: DEFAULT_WEIGHTS,
    stats: { gameId, sampleSize: 0, hot: [], cold: [], detail: '' },
  };
}

describe('comparePickToDraw', () => {
  it('scores ssq red and blue hits', () => {
    const p = pick('ssq', { red: [1, 2, 3, 4, 5, 6], blue: [7] });
    const draw: NormalizedDraw = {
      gameId: 'ssq',
      issue: '1',
      drawTime: '',
      numbers: { red: [1, 2, 3, 10, 11, 12], blue: [7] },
      source: 'fucai',
    };
    const hit = comparePickToDraw(p, draw);
    expect(hit.hits).toBe(4);
    expect(hit.detail).toContain('红3/6');
    expect(hit.detail).toContain('蓝1/1');
  });

  it('scores digit position hits', () => {
    const p = pick('fc3d', { digits: [3, 8, 1] });
    const draw: NormalizedDraw = {
      gameId: 'fc3d',
      issue: '1',
      drawTime: '',
      numbers: { digits: [3, 5, 1] },
      source: 'fucai',
    };
    const hit = comparePickToDraw(p, draw);
    expect(hit.hits).toBe(2);
    expect(hit.total).toBe(3);
  });
});

describe('tuneWeightsFromDraw', () => {
  it('returns normalized weights', () => {
    const draws: NormalizedDraw[] = [
      { gameId: 'kl8', issue: '1', drawTime: '', numbers: { main: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] }, source: 'fucai' },
    ];
    const tuned = tuneWeightsFromDraw(
      DEFAULT_WEIGHTS,
      { main: [1, 5, 10] },
      { main: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] },
      'kl8',
      draws,
    );
    const sum = tuned.freq + tuned.omit + tuned.trend;
    expect(sum).toBeCloseTo(1, 5);
  });
});
