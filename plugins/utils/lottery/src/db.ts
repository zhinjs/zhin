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
  // where 返回 PromiseLike：host 侧是链式 Selection（thenable），memory 侧是 Promise。
  select: (...fields: string[]) => {
    where: (q: Record<string, unknown>) => PromiseLike<unknown[]>;
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

function toRow(draw: NormalizedDraw, syncedAt: string): Record<string, unknown> {
  return {
    game_id: draw.gameId,
    issue: draw.issue,
    draw_time: draw.drawTime,
    numbers: JSON.stringify(draw.numbers),
    source: draw.source,
    raw_json: JSON.stringify(draw),
    synced_at: syncedAt,
  };
}

/** Issues already stored for one game (a single query). */
async function storedIssues(model: LotteryModel, gameId: string): Promise<Set<string>> {
  const rows = (await model.select().where({ game_id: gameId })) as Array<{ issue: string }>;
  return new Set(rows.map((row) => String(row.issue)));
}

export async function upsertDraws(db: LotteryDb, draws: NormalizedDraw[]): Promise<{ count: number; inserted: NormalizedDraw[] }> {
  const model = db.models.get(DRAWS_TABLE);
  if (!model) return { count: 0, inserted: [] };
  const insertedDraws: NormalizedDraw[] = [];
  const now = new Date().toISOString();
  const known = new Map<string, Set<string>>();
  for (const d of draws) {
    if (!d.issue) continue;
    let issues = known.get(d.gameId);
    if (!issues) known.set(d.gameId, issues = await storedIssues(model, d.gameId));
    if (issues.has(d.issue)) continue;
    issues.add(d.issue);
    await model.insert(toRow(d, now));
    insertedDraws.push(d);
  }
  return { count: insertedDraws.length, inserted: insertedDraws };
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

/**
 * Bring one game's stored history up to date and keep at most `historyLimit` issues.
 * Only draws that survive the limit are written, so `inserted` lists genuinely new rows:
 * a draw that would be trimmed straight away is never inserted (and never reported).
 */
export async function syncGame(
  db: LotteryDb,
  gameId: GameId,
  historyLimit: number,
  fetchDraws: typeof fetchGameDraws = fetchGameDraws,
): Promise<{ count: number; inserted: NormalizedDraw[] }> {
  const limited = historyLimit > 0;
  const draws = await fetchDraws(gameId, limited ? historyLimit : 100);
  const model = db.models.get(DRAWS_TABLE);
  if (!model) return { count: 0, inserted: [] };
  const existing = await storedIssues(model, gameId);
  const fresh = new Map<string, NormalizedDraw>();
  for (const draw of draws) {
    if (draw.issue && !existing.has(draw.issue) && !fresh.has(draw.issue)) fresh.set(draw.issue, draw);
  }
  const newestFirst = [...existing, ...fresh.keys()].sort((a, b) => b.localeCompare(a));
  const keep = new Set(limited ? newestFirst.slice(0, historyLimit) : newestFirst);
  const now = new Date().toISOString();
  const inserted: NormalizedDraw[] = [];
  for (const draw of fresh.values()) {
    if (!keep.has(draw.issue)) continue;
    await model.insert(toRow(draw, now));
    inserted.push(draw);
  }
  for (const issue of existing) {
    if (!keep.has(issue)) await model.delete().where({ game_id: gameId, issue });
  }
  return { count: inserted.length, inserted };
}
