import type { DrawNumbers, GameId, NormalizedDraw } from './types.js';
import { getGameMeta } from './games/registry.js';
import { fetchFucaiDraws, fetchTicaiDraws } from './sync/fetch-official.js';
import { defineEvalTables } from './evaluate/tracker.js';

export const DRAWS_TABLE = 'lottery_draws';
export const REPORTS_TABLE = 'lottery_daily_reports';

export interface LotteryDb {
  models: {
    get: (name: string) => LotteryModel | undefined;
  };
}

export interface LotteryModel {
  select: () => {
    where: (q: Record<string, unknown>) => Promise<unknown[]>;
  };
  insert: (row: Record<string, unknown>) => Promise<unknown>;
  delete: () => { where: (q: Record<string, unknown>) => Promise<unknown> };
}

export function defineLotteryTables(db: { define: (name: string, schema: Record<string, unknown>) => void }): void {
  db.define(DRAWS_TABLE, {
    game_id: { type: 'text', nullable: false },
    issue: { type: 'text', nullable: false },
    draw_time: { type: 'text', default: '' },
    numbers: { type: 'text', default: '{}' },
    source: { type: 'text', default: '' },
    raw_json: { type: 'text', default: '' },
    synced_at: { type: 'text', default: '' },
  });
  db.define(REPORTS_TABLE, {
    date: { type: 'text', nullable: false },
    report_json: { type: 'text', default: '{}' },
    ai_explanation: { type: 'text', default: '' },
    created_at: { type: 'text', default: '' },
  });
  defineEvalTables(db);
}

export async function upsertDraws(db: LotteryDb, draws: NormalizedDraw[]): Promise<{ count: number; inserted: NormalizedDraw[] }> {
  const model = db.models.get(DRAWS_TABLE);
  if (!model) return { count: 0, inserted: [] };
  let inserted = 0;
  const insertedDraws: NormalizedDraw[] = [];
  const now = new Date().toISOString();
  for (const d of draws) {
    if (!d.issue) continue;
    const existing = (await model.select().where({ game_id: d.gameId, issue: d.issue })) as unknown[];
    if (existing.length > 0) continue;
    await model.insert({
      game_id: d.gameId,
      issue: d.issue,
      draw_time: d.drawTime,
      numbers: JSON.stringify(d.numbers),
      source: d.source,
      raw_json: JSON.stringify(d),
      synced_at: now,
    });
    inserted++;
    insertedDraws.push(d);
  }
  return { count: inserted, inserted: insertedDraws };
}

export async function trimHistory(db: LotteryDb, gameId: GameId, limit: number): Promise<void> {
  const model = db.models.get(DRAWS_TABLE);
  if (!model || limit <= 0) return;
  const rows = (await model.select().where({ game_id: gameId })) as Array<{ issue: string }>;
  const sorted = [...rows].sort((a, b) => b.issue.localeCompare(a.issue));
  for (const row of sorted.slice(limit)) {
    await model.delete().where({ game_id: gameId, issue: row.issue });
  }
}

export function parseStoredJson<T>(value: unknown, fallback: T): T {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export async function loadDraws(db: LotteryDb, gameId: GameId, limit: number): Promise<NormalizedDraw[]> {
  const model = db.models.get(DRAWS_TABLE);
  if (!model) return [];
  const rows = (await model.select().where({ game_id: gameId })) as Array<{
    game_id: string;
    issue: string;
    draw_time: string;
    numbers: string | DrawNumbers;
    source: string;
  }>;
  return [...rows]
    .sort((a, b) => b.issue.localeCompare(a.issue))
    .slice(0, limit)
    .map((r) => ({
      gameId: r.game_id as GameId,
      issue: r.issue,
      drawTime: r.draw_time,
      numbers: parseStoredJson<DrawNumbers>(r.numbers, {}),
      source: r.source as NormalizedDraw['source'],
    }));
}

export async function fetchGameDraws(gameId: GameId, count: number): Promise<NormalizedDraw[]> {
  const meta = getGameMeta(gameId);
  if (meta.source === 'fucai' && meta.fucaiName) {
    return fetchFucaiDraws(meta.fucaiName, count);
  }
  if (meta.source === 'ticai' && meta.ticaiGameNo) {
    return fetchTicaiDraws(meta.ticaiGameNo, count);
  }
  return [];
}

export async function syncGame(
  db: LotteryDb,
  gameId: GameId,
  historyLimit: number,
): Promise<{ count: number; inserted: NormalizedDraw[] }> {
  const draws = await fetchGameDraws(gameId, Math.max(historyLimit, 100));
  const { count, inserted } = await upsertDraws(db, draws);
  await trimHistory(db, gameId, historyLimit);
  return { count, inserted };
}
