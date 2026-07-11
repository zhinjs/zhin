import type { GameId } from '../types.js';
import { loadDraws, type LotteryDb } from '../db.js';

import { loadGameWeights } from './tracker.js';
import { runAdaptiveSimulation, type SimulationResult } from './adaptive-sim.js';
import { trainGameWeights } from './train-weights.js';
import { formatWeights } from '../stats/weights.js';

export interface BacktestOptions {
  pickCount: number;
  window: number;
  randomTrials: number;
  minHistory: number;
  historyLimit?: number;
  initialWeights?: import('../types.js').ScoreWeights;
  adaptive?: boolean;
}

export type BacktestSummary = SimulationResult;

export async function walkForwardBacktest(
  db: LotteryDb,
  gameId: GameId,
  options: BacktestOptions,
): Promise<BacktestSummary | null> {
  const loadLimit = options.historyLimit ?? Math.max(options.window + options.minHistory + 50, 150);
  const draws = await loadDraws(db, gameId, loadLimit);
  if (draws.length <= options.minHistory) return null;

  const chronological = [...draws].sort((a, b) => a.issue.localeCompare(b.issue));
  return runAdaptiveSimulation(chronological, gameId, {
    pickCount: options.pickCount,
    minHistory: options.minHistory,
    randomTrials: options.randomTrials,
    initialWeights: options.initialWeights,
    adaptive: options.adaptive,
    scoreWindow: options.window,
  });
}

export async function runBacktestForGames(
  db: LotteryDb,
  gameIds: GameId[],
  options: BacktestOptions,
): Promise<BacktestSummary[]> {
  const out: BacktestSummary[] = [];
  for (const gameId of gameIds) {
    const initial = await loadGameWeights(db, gameId);
    const summary = await walkForwardBacktest(db, gameId, { ...options, initialWeights: initial });
    if (summary) out.push(summary);
  }
  return out;
}

/** Full-history training refresh (same as lottery-train) when pipeline has no live review. */
export async function refreshAndPersistWeights(
  db: LotteryDb,
  gameId: GameId,
  options: RefreshWeightsOptions,
): Promise<BacktestSummary | null> {
  const result = await trainGameWeights(db, gameId, {
    pickCount: options.pickCount,
    minHistory: options.minHistory,
    historyLimit: options.historyLimit ?? 500,
    randomTrials: options.randomTrials,
    initialWeights: options.initialWeights ?? (await loadGameWeights(db, gameId)),
    holdoutWindow: options.holdoutWindow ?? options.window,
    holdoutFallback: options.holdoutFallback,
    persist: true,
  });
  return result;
}

export interface RefreshWeightsOptions extends BacktestOptions {
  persist: boolean;
  reviewEvaluated: number;
  holdoutWindow?: number;
  holdoutFallback?: boolean;
}

export async function refreshWeightsForGames(
  db: LotteryDb,
  gameIds: GameId[],
  options: RefreshWeightsOptions,
): Promise<BacktestSummary[]> {
  if (!options.persist) return [];
  const out: BacktestSummary[] = [];
  for (const gameId of gameIds) {
    if (options.reviewEvaluated > 0) continue;
    const summary = await refreshAndPersistWeights(db, gameId, options);
    if (summary) out.push(summary);
  }
  return out;
}

function pct(rate: number): string {
  return (rate * 100).toFixed(1);
}

function signedPct(delta: number): string {
  const v = delta * 100;
  return v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
}

export function formatBacktestLine(s: BacktestSummary): string {
  const w = formatWeights(s.finalWeights);
  return [
    `${s.gameId}: 调优 ${pct(s.adaptiveAvgHitRate)}%`,
    `固定 ${pct(s.fixedAvgHitRate)}%`,
    `随机 ${pct(s.randomAvgHitRate)}%`,
    `(Δ调优-随机 ${signedPct(s.adaptiveVsRandom)}%, n=${s.periods}, 热身${s.warmupPeriods}期)`,
    `终权重 ${w}`,
  ].join(' / ');
}

export function formatBacktestSection(summaries: BacktestSummary[]): string {
  if (!summaries.length) return '';
  const lines = [
    '【回测可信度】近 N 期 walk-forward 抽样（全量训练请用 lottery-train）',
    ...summaries.map(formatBacktestLine),
    '说明：Δ 接近 0 为正常；终权重见 lottery_model_weights。',
    '推荐时若近端调优输给随机，将自动回退默认 F40/O35/T25（见【权重保护】）。',
  ];
  return lines.join('\n');
}

export type { TrainWeightsOptions } from './train-weights.js';
export { trainGameWeights, trainAllGameWeights, formatTrainReport } from './train-weights.js';
