import { DEFAULT_WEIGHTS, type GameId, type ScoreWeights } from '../types.js';

import type { LotteryDb } from '../db.js';
import { loadGameWeights } from './tracker.js';
import type { SimulationResult } from './adaptive-sim.js';
import { walkForwardBacktest, type BacktestOptions } from './backtest.js';

export interface WeightPlan {
  /** Explicit weights for recommend; only lists holdout-fallback games. */
  overrides: Map<GameId, ScoreWeights>;
  fallbacks: GameId[];
}

export function gamesToPredict(
  gameIds: GameId[],
  missingToday: GameId[],
  weightPlan: WeightPlan,
): GameId[] {
  const regenFallback = weightPlan.fallbacks.filter((g) => !missingToday.includes(g));
  const ordered = new Set<GameId>();
  for (const gid of gameIds) {
    if (missingToday.includes(gid) || regenFallback.includes(gid)) ordered.add(gid);
  }
  return [...ordered];
}

export function planRecommendWeights(
  gameIds: GameId[],
  holdoutSummaries: SimulationResult[],
  holdoutFallback: boolean,
): WeightPlan {
  const byGame = new Map(holdoutSummaries.map((s) => [s.gameId, s]));
  const overrides = new Map<GameId, ScoreWeights>();
  const fallbacks: GameId[] = [];
  if (!holdoutFallback) return { overrides, fallbacks };

  for (const gid of gameIds) {
    const summary = byGame.get(gid);
    if (summary && summary.adaptiveVsRandom < 0) {
      overrides.set(gid, { ...DEFAULT_WEIGHTS });
      fallbacks.push(gid);
    }
  }
  return { overrides, fallbacks };
}

export async function runHoldoutBacktest(
  db: LotteryDb,
  gameIds: GameId[],
  options: BacktestOptions,
): Promise<SimulationResult[]> {
  const out: SimulationResult[] = [];
  for (const gameId of gameIds) {
    const initial = await loadGameWeights(db, gameId);
    const summary = await walkForwardBacktest(db, gameId, { ...options, initialWeights: initial });
    if (summary) out.push(summary);
  }
  return out;
}

export function formatWeightFallbackNote(fallbacks: GameId[]): string {
  if (!fallbacks.length) return '';
  return `【权重保护】近端 holdout 调优未跑赢随机，以下玩法已回退默认 F40/O35/T25：${fallbacks.join(', ')}`;
}

export function shouldFallbackWeights(summary: SimulationResult | null | undefined): boolean {
  return summary != null && summary.adaptiveVsRandom < 0;
}
