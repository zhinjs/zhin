import type { GameId } from './types.js';
import { syncGame, type LotteryDb } from './db.js';

import {
  buildDailyReport,
  formatDailyReportText,
  hydrateReportPickWeights,
  resolveTodayReport,
  saveDailyReport,
} from './recommend/report.js';
import { evaluatePendingPredictions, gamesNeedingPrediction } from './evaluate/review-pending.js';
import { formatBacktestSection, refreshWeightsForGames, runBacktestForGames } from './evaluate/backtest.js';
import {
  planRecommendWeights,
  gamesToPredict,
  runHoldoutBacktest,
} from './evaluate/weight-guard.js';
import { cancelTodayPendingPredictions } from './evaluate/tracker.js';
import { pushLotteryReport, getLotteryOutboundPush } from './push.js';
import type { Kl8Config } from './games/kl8-groups.js';

export interface PipelineDeps {
  getDb: () => LotteryDb | null;
  enabledGames: () => GameId[];
  historyLimit: number;
  pickCount: number;
  kl8: Kl8Config;
  backtest: {
    enabled: boolean;
    window: number;
    randomTrials: number;
    minHistory: number;
    adaptive: boolean;
  };
  weightPersist: boolean;
  weightHoldoutFallback: boolean;
}

function backtestOpts(deps: PipelineDeps) {
  return {
    pickCount: deps.pickCount,
    window: deps.backtest.window,
    randomTrials: deps.backtest.randomTrials,
    minHistory: deps.backtest.minHistory,
    historyLimit: deps.historyLimit,
    adaptive: deps.backtest.adaptive,
  };
}

async function attachBacktestOverview(
  db: LotteryDb,
  gameIds: GameId[],
  deps: PipelineDeps,
  holdoutSummaries: import('./evaluate/adaptive-sim.js').SimulationResult[] = [],
): Promise<string> {
  if (!deps.backtest.enabled || deps.backtest.window <= 0) return '';
  const summaries = holdoutSummaries.length
    ? holdoutSummaries
    : await runBacktestForGames(db, gameIds, backtestOpts(deps));
  return formatBacktestSection(summaries);
}

export interface PipelineOptions {
  gameId?: GameId;
  push?: boolean;
}

export interface PipelineStepResult {
  sync: string;
  review: string;
  recommend: string;
  pushed: boolean;
  reportText: string;
}

export async function runLotteryPipeline(
  deps: PipelineDeps,
  options: PipelineOptions = {},
): Promise<PipelineStepResult> {
  const db = deps.getDb();
  if (!db) {
    return {
      sync: 'db not ready',
      review: 'skipped',
      recommend: 'skipped',
      pushed: false,
      reportText: '数据库未就绪',
    };
  }

  const gameIds = options.gameId ? [options.gameId] : deps.enabledGames();
  const syncParts: string[] = [];
  const insertedAll = [];

  for (const id of gameIds) {
    try {
      const { count, inserted } = await syncGame(db, id, deps.historyLimit);
      syncParts.push(`${id}:+${count}`);
      insertedAll.push(...inserted);
    } catch {
      syncParts.push(`${id}:err`);
    }
  }

  const reviewResult = await evaluatePendingPredictions(
    db,
    gameIds,
    deps.historyLimit,
    insertedAll,
  );
  const reviewText = reviewResult.skipped
    ? 'skipped (no pending)'
    : reviewResult.lines.length
      ? reviewResult.lines.join('; ')
      : 'no match';

  await refreshWeightsForGames(db, gameIds, {
    ...backtestOpts(deps),
    persist: deps.weightPersist,
    reviewEvaluated: reviewResult.evaluated,
    holdoutWindow: deps.backtest.window,
    holdoutFallback: deps.weightHoldoutFallback,
  });

  const holdoutSummaries = deps.backtest.enabled && deps.backtest.window > 0
    ? await runHoldoutBacktest(db, gameIds, backtestOpts(deps))
    : [];

  const missingToday = await gamesNeedingPrediction(db, gameIds);
  const weightPlan = planRecommendWeights(gameIds, holdoutSummaries, deps.weightHoldoutFallback);
  for (const gid of weightPlan.fallbacks) {
    if (!missingToday.includes(gid)) await cancelTodayPendingPredictions(db, gid);
  }
  const needPredict = gamesToPredict(gameIds, missingToday, weightPlan);

  let reportText = '';
  let recommendText: string;

  if (!needPredict.length) {
    const existing = await resolveTodayReport(db, gameIds);
    if (existing) {
      recommendText = 'reused today picks';
      existing.weightFallbackGames = weightPlan.fallbacks.length ? weightPlan.fallbacks : undefined;
      existing.backtestOverview = await attachBacktestOverview(db, gameIds, deps, holdoutSummaries);
      reportText = formatDailyReportText(existing, '');
    } else {
      recommendText = 'skipped (no picks available)';
    }
  } else {
    const report = await buildDailyReport(
      db,
      needPredict,
      { pickCount: deps.pickCount, historyLimit: deps.historyLimit, kl8: deps.kl8 },
      new Date(),
      true,
      weightPlan.overrides,
    );
    report.weightFallbackGames = weightPlan.fallbacks.length ? weightPlan.fallbacks : undefined;
    report.backtestOverview = await attachBacktestOverview(db, gameIds, deps, holdoutSummaries);

    if (needPredict.length < gameIds.length) {
      const existing = await resolveTodayReport(db, gameIds);
      if (existing?.picks?.length) {
        const regen = new Set(needPredict);
        report.picks = [
          ...existing.picks.filter((p) => !regen.has(p.gameId)),
          ...report.picks,
        ];
      }
    }
    report.picks = await hydrateReportPickWeights(db, report.picks);

    const aiNote = '';
    reportText = formatDailyReportText(report, aiNote);
    await saveDailyReport(db, report, aiNote);
    recommendText = weightPlan.fallbacks.some((g) => needPredict.includes(g))
      ? `saved ${needPredict.join(', ')} (holdout fallback regen)`
      : `saved ${needPredict.join(', ')}`;
  }

  let pushed = false;
  if (options.push && reportText && getLotteryOutboundPush()) {
    await pushLotteryReport(reportText);
    pushed = true;
  }

  return {
    sync: syncParts.join(', ') || 'none',
    review: reviewText,
    recommend: recommendText,
    pushed,
    reportText,
  };
}

export function formatPipelineReply(result: PipelineStepResult): string {
  if (result.reportText.trim()) return result.reportText.trim();
  return '暂无推荐号码，请确认已同步开奖数据。';
}
