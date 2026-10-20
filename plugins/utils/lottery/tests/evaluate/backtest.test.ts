import { describe, it, expect } from 'vitest';
import { randomDrawNumbers } from '../../src/evaluate/adaptive-sim.js';
import { walkForwardBacktest, formatBacktestSection } from '../../src/evaluate/backtest.js';
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
  return { models: { get: (n: string) => {
    const store = tables.get(n);
    if (!store) return undefined;
    return {
      select: () => ({
        where: async (q: Record<string, unknown>) =>
          [...store.values()].filter((r) => Object.entries(q).every(([k, v]) => r[k] === v)),
      }),
      insert: async (row: Record<string, unknown>) => {
        store.set(String(Math.random()), row);
      },
      delete: () => ({ where: async () => {} }),
    };
  } } } as never;
}

function fc3dDraws(count: number): NormalizedDraw[] {
  const out: NormalizedDraw[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      gameId: 'fc3d',
      issue: String(2025001 + i),
      drawTime: '',
      numbers: { digits: [i % 10, (i + 3) % 10, (i + 7) % 10] },
      source: 'fucai',
    });
  }
  return out;
}

describe('randomDrawNumbers', () => {
  it('generates valid ssq shape', () => {
    const n = randomDrawNumbers('ssq', 5, () => 0.5);
    expect(n.red).toHaveLength(6);
    expect(n.blue).toHaveLength(1);
    expect(new Set(n.red).size).toBe(6);
  });

  it('generates valid fc3d shape', () => {
    const n = randomDrawNumbers('fc3d', 5, () => 0.1);
    expect(n.digits).toHaveLength(3);
  });
});

describe('walkForwardBacktest', () => {
  it('compares strategy to random on historical draws', async () => {
    const db = mockDbWithDraws(fc3dDraws(45));
    const summary = await walkForwardBacktest(db, 'fc3d', {
      pickCount: 5,
      window: 10,
      randomTrials: 24,
      minHistory: 30,
    });
    expect(summary).not.toBeNull();
    expect(summary!.periods).toBe(10);
    expect(summary!.adaptiveAvgHitRate).toBeGreaterThanOrEqual(0);
    expect(summary!.fixedAvgHitRate).toBeGreaterThanOrEqual(0);
    expect(summary!.randomAvgHitRate).toBeGreaterThanOrEqual(0);
    expect(summary!.warmupPeriods).toBeGreaterThanOrEqual(0);
    expect(formatBacktestSection([summary!])).toContain('调优');
  });

  it('returns null when history is too short', async () => {
    const db = mockDbWithDraws(fc3dDraws(10));
    const summary = await walkForwardBacktest(db, 'fc3d', {
      pickCount: 5,
      window: 50,
      randomTrials: 10,
      minHistory: 30,
    });
    expect(summary).toBeNull();
  });
});
