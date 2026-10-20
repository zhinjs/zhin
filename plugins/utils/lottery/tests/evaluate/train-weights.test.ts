import { describe, it, expect } from 'vitest';
import { trainGameWeights, formatTrainReport } from '../../src/evaluate/train-weights.js';
import { DEFAULT_WEIGHTS, type NormalizedDraw } from '../../src/types.js';
import { defineLotteryTables } from '../../src/db.js';

function mockDb(draws: NormalizedDraw[]) {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  defineLotteryTables({ define: (n) => tables.set(n, new Map()) });
  const store = tables.get('lottery_draws')!;
  for (const d of draws) {
    store.set(`${d.gameId}:${d.issue}`, {
      game_id: d.gameId,
      issue: d.issue,
      draw_time: '',
      numbers: JSON.stringify(d.numbers),
      source: d.source,
    });
  }
  return {
    models: {
      get: (name: string) => {
        const s = tables.get(name)!;
        return {
          select: () => ({
            where: async (q: Record<string, unknown>) =>
              [...s.values()].filter((r) => Object.entries(q).every(([k, v]) => r[k] === v)),
          }),
          insert: async (row: Record<string, unknown>) => {
            s.set(String(Math.random()), row);
          },
          delete: () => ({ where: async () => {} }),
        };
      },
    },
  } as never;
}

function draws(count: number): NormalizedDraw[] {
  return Array.from({ length: count }, (_, i) => ({
    gameId: 'ssq' as const,
    issue: String(2025001 + i),
    drawTime: '',
    numbers: {
      red: [1, 2, 3, 4, 5, 6].map((n) => ((n + i) % 33) + 1),
      blue: [(i % 16) + 1],
    },
    source: 'fucai' as const,
  }));
}

describe('trainGameWeights', () => {
  it('runs full history from DEFAULT and changes weights', async () => {
    const db = mockDb(draws(40));
    const result = await trainGameWeights(db, 'ssq', {
      pickCount: 5,
      minHistory: 10,
      historyLimit: 100,
      randomTrials: 8,
      persist: false,
    });
    expect(result).not.toBeNull();
    expect(result!.trainSteps).toBe(30);
    expect(result!.initialWeights).toEqual(DEFAULT_WEIGHTS);
    const sum = result!.finalWeights.freq + result!.finalWeights.omit + result!.finalWeights.trend;
    expect(sum).toBeCloseTo(1, 5);
    expect(formatTrainReport([result!])).toContain('ssq');
  });
});
