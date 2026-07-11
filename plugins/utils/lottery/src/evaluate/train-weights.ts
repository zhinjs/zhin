import { DEFAULT_WEIGHTS, type GameId, type ScoreWeights } from '../types.js';

import { loadDraws, type LotteryDb } from '../db.js';

import { runAdaptiveSimulation, type SimulationResult } from './adaptive-sim.js';
import { walkForwardBacktest } from './backtest.js';
import { shouldFallbackWeights } from './weight-guard.js';
import { saveGameWeights } from './tracker.js';
import { formatWeights } from '../stats/weights.js';

export interface TrainWeightsOptions {
  pickCount: number;
  minHistory: number;
  historyLimit: number;
  randomTrials: number;
  /** Start training from these weights; default F40/O35/T25. */
  initialWeights?: ScoreWeights;
  persist?: boolean;
  holdoutWindow?: number;
  holdoutFallback?: boolean;
}

export interface TrainWeightsResult extends SimulationResult {
  totalDraws: number;
  trainSteps: number;
  holdoutFallbackApplied?: boolean;
}

async function loadChronologicalDraws(db: LotteryDb, gameId: GameId, limit: number) {
  const draws = await loadDraws(db, gameId, limit);
  return [...draws].sort((a, b) => a.issue.localeCompare(b.issue));
}

/**
 * Full-history training: from first predictable issue through all DB draws,
 * predict → compare → tune weights each step; optionally persist final weights.
 */
export async function trainGameWeights(
  db: LotteryDb,
  gameId: GameId,
  options: TrainWeightsOptions,
): Promise<TrainWeightsResult | null> {
  const chronological = await loadChronologicalDraws(db, gameId, options.historyLimit);
  if (chronological.length <= options.minHistory) return null;

  const initial = options.initialWeights ?? { ...DEFAULT_WEIGHTS };
  const sim = runAdaptiveSimulation(chronological, gameId, {
    pickCount: options.pickCount,
    minHistory: options.minHistory,
    randomTrials: options.randomTrials,
    initialWeights: initial,
    adaptive: true,
    // no scoreWindow → every training step is scored
  });
  if (!sim) return null;

  if (options.persist !== false) {
    let weightsToSave = sim.finalWeights;
    let holdoutFallbackApplied = false;
    if (options.holdoutFallback !== false && options.holdoutWindow && options.holdoutWindow > 0) {
      const holdout = await walkForwardBacktest(db, gameId, {
        pickCount: options.pickCount,
        minHistory: options.minHistory,
        randomTrials: options.randomTrials,
        historyLimit: options.historyLimit,
        window: options.holdoutWindow,
        initialWeights: { ...DEFAULT_WEIGHTS },
      });
      if (shouldFallbackWeights(holdout)) {
        weightsToSave = { ...DEFAULT_WEIGHTS };
        holdoutFallbackApplied = true;
      }
    }
    await saveGameWeights(db, gameId, weightsToSave, sim.periods, sim.adaptiveAvgHitRate);
    return {
      ...sim,
      finalWeights: weightsToSave,
      totalDraws: chronological.length,
      trainSteps: sim.periods,
      holdoutFallbackApplied,
    };
  }

  return {
    ...sim,
    totalDraws: chronological.length,
    trainSteps: sim.periods,
  };
}

export async function trainAllGameWeights(
  db: LotteryDb,
  gameIds: GameId[],
  options: TrainWeightsOptions,
): Promise<TrainWeightsResult[]> {
  const out: TrainWeightsResult[] = [];
  for (const gameId of gameIds) {
    const result = await trainGameWeights(db, gameId, options);
    if (result) out.push(result);
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

export function formatTrainLine(r: TrainWeightsResult): string {
  const init = formatWeights(r.initialWeights);
  const fin = formatWeights(r.finalWeights);
  const fallback = r.holdoutFallbackApplied ? ' [holdout→默认]' : '';
  return [
    `${r.gameId}: 训练${r.trainSteps}期 (${r.firstScoredIssue}→${r.lastScoredIssue})${fallback}`,
    `命中 调优${pct(r.adaptiveAvgHitRate)}% / 固定${pct(r.fixedAvgHitRate)}% / 随机${pct(r.randomAvgHitRate)}%`,
    `Δ调优-随机 ${signedPct(r.adaptiveVsRandom)}%`,
    `权重 ${init} → ${fin}`,
  ].join('\n  ');
}

export function formatTrainReport(results: TrainWeightsResult[]): string {
  if (!results.length) return '训练失败：历史数据不足，请先同步开奖。';
  const lines = [
    '【权重训练】全历史 walk-forward：预测→比对→调权，已写入 lottery_model_weights',
    ...results.map(formatTrainLine),
    '',
    '说明：训练≠保证未来更准；终权重供后续 lottery 推荐使用。',
  ];
  return lines.join('\n');
}
