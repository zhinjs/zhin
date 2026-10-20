import type { GameId, NormalizedDraw } from '../types.js';
import { loadDraws, type LotteryDb } from '../db.js';

import { formatHitSummary } from './hit-rate.js';
import {
  listPendingPredictions,
  PREDICTIONS_TABLE,
  submitAgentReview,
} from './tracker.js';

export interface EvaluatePendingResult {
  evaluated: number;
  skipped: boolean;
  lines: string[];
}

async function isIssueAlreadyReviewed(db: LotteryDb, gameId: GameId, issue: string): Promise<boolean> {
  const predModel = db.models.get(PREDICTIONS_TABLE);
  if (!predModel) return false;
  const rows = (await predModel.select().where({
    game_id: gameId,
    status: 'evaluated',
    actual_issue: issue,
  })) as unknown[];
  return rows.length > 0;
}

function drawsForReview(
  gameId: GameId,
  insertedDraws: NormalizedDraw[],
  latestInDb: NormalizedDraw | undefined,
  stalePending: boolean,
): NormalizedDraw[] {
  const inserted = insertedDraws
    .filter((d) => d.gameId === gameId)
    .sort((a, b) => a.issue.localeCompare(b.issue));
  if (inserted.length) return inserted;
  if (stalePending && latestInDb) return [latestInDb];
  return [];
}

/** Match pending picks to new or latest draws; skip when nothing pending. */
export async function evaluatePendingPredictions(
  db: LotteryDb,
  gameIds: GameId[],
  historyLimit: number,
  insertedDraws: NormalizedDraw[] = [],
): Promise<EvaluatePendingResult> {
  const lines: string[] = [];
  let evaluated = 0;
  let hadPending = false;
  const today = new Date().toISOString().slice(0, 10);

  for (const gameId of gameIds) {
    const pending = (await listPendingPredictions(db, gameId)) as Array<{
      predict_at: string;
      predict_date: string;
    }>;
    if (!pending.length) continue;
    hadPending = true;

    const stale = pending.filter((p) => p.predict_date < today);
    const todayOnly = pending.filter((p) => p.predict_date === today);
    const latest = (await loadDraws(db, gameId, 1))[0];
    const useStale = stale.length > 0 && latest && !(await isIssueAlreadyReviewed(db, gameId, latest.issue));
    const drawsToMatch = drawsForReview(gameId, insertedDraws, latest, useStale);

    if (!drawsToMatch.length) {
      if (todayOnly.length) {
        lines.push(`${gameId}: waiting for next draw`);
      } else {
        lines.push(`${gameId}: pending, no matching draw yet`);
      }
      continue;
    }

    const pool = useStale ? [...stale] : [...pending];
    const orderedPending = pool.sort((a, b) => a.predict_at.localeCompare(b.predict_at));
    for (const draw of drawsToMatch) {
      const row = orderedPending.shift();
      if (!row) break;
      const hit = await submitAgentReview(
        db,
        {
          gameId,
          predictAt: row.predict_at,
          actualIssue: draw.issue,
          actualNumbers: draw.numbers,
          analysis: '',
        },
        historyLimit,
      );
      if (hit) {
        evaluated++;
        lines.push(formatHitSummary(gameId, hit, draw.issue));
      }
    }
  }

  if (!hadPending) {
    return { evaluated: 0, skipped: true, lines: ['no pending predictions'] };
  }
  return { evaluated, skipped: false, lines };
}

/** Games that still need a next-period pick (no pending row for today). */
export async function gamesNeedingPrediction(db: LotteryDb, gameIds: GameId[], date = new Date()): Promise<GameId[]> {
  const today = date.toISOString().slice(0, 10);
  const out: GameId[] = [];
  for (const gid of gameIds) {
    const pending = (await listPendingPredictions(db, gid)) as Array<{ predict_date: string }>;
    if (!pending.some((p) => p.predict_date === today)) out.push(gid);
  }
  return out;
}

export async function latestDrawIssue(db: LotteryDb, gameId: GameId): Promise<string | null> {
  const draws = await loadDraws(db, gameId, 1);
  return draws[0]?.issue ?? null;
}
