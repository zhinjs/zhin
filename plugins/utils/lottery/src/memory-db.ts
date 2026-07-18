import type { LotteryDb, LotteryModel } from './db.js';
import {
  DRAWS_TABLE,
  REPORTS_TABLE,
} from './db.js';
import {
  MEMORY_TABLE,
  PREDICTIONS_TABLE,
  WEIGHTS_TABLE,
} from './evaluate/tracker.js';

/** Minimal in-memory model matching LotteryModel (select/insert/delete). */
function createMemoryModel(): LotteryModel {
  const rows: Record<string, unknown>[] = [];

  function matches(row: Record<string, unknown>, query: Record<string, unknown>): boolean {
    return Object.entries(query).every(([key, value]) => row[key] === value);
  }

  return {
    select: () => ({
      where: async (query: Record<string, unknown>) => rows.filter((row) => matches(row, query)),
    }),
    insert: async (row: Record<string, unknown>) => {
      rows.push({ ...row });
      return row;
    },
    delete: () => ({
      where: async (query: Record<string, unknown>) => {
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (matches(rows[i]!, query)) rows.splice(i, 1);
        }
      },
    }),
  };
}

const TABLE_NAMES = [
  DRAWS_TABLE,
  REPORTS_TABLE,
  PREDICTIONS_TABLE,
  WEIGHTS_TABLE,
  MEMORY_TABLE,
] as const;

/**
 * Slice-2 fallback while Plugin Runtime has no DatabaseFeature Resource path.
 * Enough for smoke: today/history/stats/train/backtest/pipeline no longer return「数据库未就绪」.
 */
export function createInMemoryLotteryDb(): LotteryDb {
  const models = new Map<string, LotteryModel>();
  for (const name of TABLE_NAMES) {
    models.set(name, createMemoryModel());
  }
  return {
    models: {
      get: (name: string) => models.get(name),
    },
  };
}
