import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lotteryDateKey } from '../src/date-key.js';
import { gamesNeedingPrediction } from '../src/evaluate/review-pending.js';
import { defineEvalTables, savePrediction } from '../src/evaluate/tracker.js';
import { buildDailyReport, loadTodayReport, resolveTodayReport, saveDailyReport } from '../src/recommend/report.js';
import { DEFAULT_WEIGHTS, type GameId, type GamePick } from '../src/types.js';

// 2026-01-06 01:00 in Asia/Shanghai: still 2026-01-05 in UTC.
const EARLY_MORNING = new Date('2026-01-05T17:00:00Z');

function mockDb() {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  const models = {
    get: (name: string) => {
      if (!tables.has(name)) tables.set(name, new Map());
      const store = tables.get(name)!;
      return {
        select: () => ({
          where: async (q: Record<string, unknown>) => [...store.values()]
            .filter((r) => Object.entries(q).every(([k, v]) => r[k] === v)),
        }),
        insert: async (row: Record<string, unknown>) => {
          store.set(`${row.game_id ?? ''}:${row.predict_at ?? row.issue ?? row.date}`, { ...row });
        },
        delete: () => ({ where: async () => {} }),
      };
    },
  };
  defineEvalTables({ define: (n) => tables.set(n, new Map()) });
  return { models } as never;
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

describe('lottery calendar day (#1250)', () => {
  let previousTz: string | undefined;
  beforeEach(() => { previousTz = process.env.TZ; process.env.TZ = 'Asia/Shanghai'; });
  afterEach(() => { if (previousTz === undefined) delete process.env.TZ; else process.env.TZ = previousTz; });

  it('uses the local day, not the UTC day, between 00:00 and 08:00 in Asia/Shanghai', () => {
    expect(lotteryDateKey(EARLY_MORNING)).toBe('2026-01-06');
  });

  it('dates the daily report and its pending predictions by the local day', async () => {
    const db = mockDb();
    const report = await buildDailyReport(db, [], { pickCount: 5, historyLimit: 10 }, EARLY_MORNING);
    expect(report.date).toBe('2026-01-06');
    await savePrediction(db, pick('ssq'), EARLY_MORNING);
    const today = await resolveTodayReport(db, ['ssq'], EARLY_MORNING, 'en');
    expect(today?.date).toBe('2026-01-06');
    expect(today?.picks).toHaveLength(1);
    expect(await gamesNeedingPrediction(db, ['ssq', 'kl8'], EARLY_MORNING)).toEqual(['kl8']);
  });

  it('finds a saved report under the local day', async () => {
    const db = mockDb();
    await saveDailyReport(db, { date: '2026-01-06', picks: [pick('ssq')], disclaimer: 'd' }, '');
    expect((await loadTodayReport(db, EARLY_MORNING))?.date).toBe('2026-01-06');
  });
});
