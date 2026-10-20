import { describe, it, expect } from 'vitest';
import { trainGameWeights } from '../../src/evaluate/train-weights.js';
import { hasWeightsRow, loadGameWeights } from '../../src/evaluate/tracker.js';
import { defineLotteryTables } from '../../src/db.js';
import type { NormalizedDraw } from '../../src/types.js';

function mockDbWithDraws(draws: NormalizedDraw[]) {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  defineLotteryTables({
    define: (name) => {
      if (!tables.has(name)) tables.set(name, new Map());
    },
  });
  const drawStore = tables.get('lottery_draws')!;
  for (const d of draws) {
    drawStore.set(`${d.gameId}:${d.issue}`, {
      game_id: d.gameId,
      issue: d.issue,
      draw_time: d.drawTime,
      numbers: JSON.stringify(d.numbers),
      source: d.source,
    });
  }
  return {
    models: {
      get: (name: string) => {
        const store = tables.get(name);
        if (!store) return undefined;
        return {
          select: () => ({
            where: async (q: Record<string, unknown>) =>
              [...store.values()].filter((r) => Object.entries(q).every(([k, v]) => r[k] === v)),
          }),
          insert: async (row: Record<string, unknown>) => {
            const key = `${row.game_id ?? ''}:${row.freq_weight ?? Math.random()}`;
            store.set(key, { ...row });
          },
          delete: () => ({
            where: async (q: Record<string, unknown>) => {
              for (const [k, r] of [...store.entries()]) {
                if (Object.entries(q).every(([fk, fv]) => r[fk] === fv)) store.delete(k);
              }
            },
          }),
        };
      },
    },
  } as never;
}

function fc3dDraws(count: number): NormalizedDraw[] {
  return Array.from({ length: count }, (_, i) => ({
    gameId: 'fc3d' as const,
    issue: String(2025001 + i),
    drawTime: '',
    numbers: { digits: [i % 10, (i + 3) % 10, (i + 7) % 10] },
    source: 'fucai' as const,
  }));
}

describe('trainGameWeights', () => {
  it('writes final weights to lottery_model_weights', async () => {
    const db = mockDbWithDraws(fc3dDraws(45));
    expect(await hasWeightsRow(db, 'fc3d')).toBe(false);
    const summary = await trainGameWeights(db, 'fc3d', {
      pickCount: 5,
      randomTrials: 16,
      minHistory: 30,
      historyLimit: 100,
    });
    expect(summary).not.toBeNull();
    expect(summary!.trainSteps).toBe(15);
    expect(await hasWeightsRow(db, 'fc3d')).toBe(true);
    const w = await loadGameWeights(db, 'fc3d');
    expect(w.freq + w.omit + w.trend).toBeCloseTo(1, 5);
  });
});
