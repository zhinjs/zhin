import { describe, it, expect } from 'vitest';
import { evaluatePendingPredictions, gamesNeedingPrediction } from '../../src/evaluate/review-pending.js';
import { savePrediction, defineEvalTables } from '../../src/evaluate/tracker.js';

import { DEFAULT_WEIGHTS, type GameId, type GamePick, type NormalizedDraw } from '../../src/types.js';

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
          where: async (q: Record<string, unknown>) => {
            for (const [k, r] of [...store.entries()]) {
              if (Object.entries(q).every(([fk, fv]) => r[fk] === fv)) store.delete(k);
            }
          },
        }),
      };
    },
  };
  const db = { models, define: (_n: string, _s: Record<string, unknown>) => defineEvalTables({ define: () => {} }) };
  defineEvalTables({ define: (n, _s) => tables.set(n, new Map()) });
  return { db: db as never, tables };
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

describe('evaluatePendingPredictions', () => {
  it('skips when no pending predictions', async () => {
    const { db } = mockDb();
    const result = await evaluatePendingPredictions(db, ['ssq'], 100, []);
    expect(result.skipped).toBe(true);
    expect(result.evaluated).toBe(0);
  });

  it('evaluates pending against newly inserted draw', async () => {
    const { db } = mockDb();
    await savePrediction(db, pick('ssq'), new Date('2026-07-10T18:00:00Z'));
    const inserted: NormalizedDraw[] = [{
      gameId: 'ssq',
      issue: '2025088',
      drawTime: '2026-07-11',
      numbers: { red: [1, 2, 3, 10, 11, 12], blue: [7] },
      source: 'fucai',
    }];
    const result = await evaluatePendingPredictions(db, ['ssq'], 100, inserted);
    expect(result.evaluated).toBe(1);
    expect(result.lines[0]).toContain('ssq');
  });

  it('reports waiting when only today pending and no new draw', async () => {
    const { db } = mockDb();
    await savePrediction(db, pick('ssq'), new Date('2026-07-11T12:00:00Z'));
    const result = await evaluatePendingPredictions(db, ['ssq'], 100, []);
    expect(result.evaluated).toBe(0);
    expect(result.lines[0]).toContain('waiting for next draw');
  });
});

describe('gamesNeedingPrediction', () => {
  it('excludes games with pending for today', async () => {
    const { db } = mockDb();
    await savePrediction(db, pick('ssq'), new Date('2026-07-11T12:00:00Z'));
    const need = await gamesNeedingPrediction(db, ['ssq', 'kl8'], new Date('2026-07-11T12:00:00Z'));
    expect(need).toEqual(['kl8']);
  });
});
