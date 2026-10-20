import { describe, it, expect } from 'vitest';
import { resolveTodayReport } from '../../src/recommend/report.js';
import { savePrediction, defineEvalTables } from '../../src/evaluate/tracker.js';

import { DEFAULT_WEIGHTS, type GameId, type GamePick } from '../../src/types.js';

function mockDb() {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  const models = {
    get: (name: string) => {
      if (!tables.has(name)) tables.set(name, new Map());
      const store = tables.get(name)!;
      return {
        select: () => ({
          where: async (q: Record<string, unknown>) => {
            const rows = [...store.values()];
            return rows.filter((r) => Object.entries(q).every(([k, v]) => r[k] === v));
          },
        }),
        insert: async (row: Record<string, unknown>) => {
          const key = `${row.game_id ?? ''}:${row.predict_at ?? row.issue ?? row.date ?? Math.random()}`;
          store.set(key, { ...row });
        },
        delete: () => ({
          where: async () => {},
        }),
      };
    },
  };
  defineEvalTables({ define: (n) => tables.set(n, new Map()) });
  return { db: { models } as never };
}

function pick(gameId: GameId): GamePick {
  return {
    gameId,
    label: gameId,
    numbers: { red: [1, 2, 3, 4, 5, 6], blue: [7] },
    weights: DEFAULT_WEIGHTS,
    stats: { gameId, sampleSize: 0, hot: [], cold: [], detail: '' },
  };
}

describe('resolveTodayReport', () => {
  it('reconstructs report from today pending picks', async () => {
    const { db } = mockDb();
    const at = new Date('2026-07-11T14:00:00Z');
    await savePrediction(db, pick('ssq'), at);
    const report = await resolveTodayReport(db, ['ssq'], at);
    expect(report?.picks).toHaveLength(1);
    expect(report?.picks[0]?.numbers.red).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
