import { DEFAULT_WEIGHTS, DISCLAIMER, type DailyReport, type DrawNumbers, type GameId, type GamePick, type ScoreWeights } from '../types.js';

import { recommendGame, formatPickLine, formatPickStats } from './game-pick.js';
import { resolveKl8Config, type Kl8Config } from '../games/kl8-groups.js';

import { loadDraws, REPORTS_TABLE, parseStoredJson, type LotteryDb } from '../db.js';

import { listPendingPredictions, loadAccuracySnapshot, loadGameWeights, savePrediction } from '../evaluate/tracker.js';

export interface LotteryConfigSlice {
  pickCount: number;
  historyLimit: number;
  kl8?: Kl8Config;
}

export async function buildDailyReport(
  db: LotteryDb,
  gameIds: GameId[],
  config: LotteryConfigSlice,
  date = new Date(),
  savePredictions = true,
  weightOverrides?: Map<GameId, ScoreWeights>,
): Promise<DailyReport> {
  const dateStr = date.toISOString().slice(0, 10);
  const tieSeed = dateStr;
  const picks = [];
  for (const gameId of gameIds) {
    const draws = await loadDraws(db, gameId, config.historyLimit);
    if (!draws.length) continue;
    const weights = weightOverrides?.get(gameId) ?? (await loadGameWeights(db, gameId));
    const accuracy = await loadAccuracySnapshot(db, gameId);
    const kl8 = config.kl8 ?? resolveKl8Config(config.pickCount);
    const pick = recommendGame(gameId, draws, {
      pickCount: gameId === 'kl8' ? kl8.pickCount : config.pickCount,
      tieSeed,
      weights,
      accuracy,
      kl8: gameId === 'kl8' ? kl8 : undefined,
    });
    picks.push(pick);
    if (savePredictions) await savePrediction(db, pick, date);
  }
  const accuracyOverview = picks
    .filter((p) => p.stats.accuracy)
    .map((p) => `${p.gameId} ${((p.stats.accuracy?.avgHitRate ?? 0) * 100).toFixed(1)}%`)
    .join(' | ');
  return {
    date: dateStr,
    picks,
    disclaimer: DISCLAIMER,
    accuracyOverview: accuracyOverview || undefined,
  };
}

export function formatDailyReportText(report: DailyReport, aiExplanation?: string): string {
  if (report.body?.trim()) {
    const extra = aiExplanation?.trim();
    return extra ? `${report.body.trim()}\n\n${extra}` : report.body.trim();
  }
  const lines = [`【彩票每日推荐】${report.date}`, ''];
  if (report.backtestOverview?.trim()) {
    lines.push(report.backtestOverview.trim());
    lines.push('');
  }
  if (report.weightFallbackGames?.length) {
    lines.push(`【权重保护】近端 holdout 调优未跑赢随机，已回退默认 F40/O35/T25：${report.weightFallbackGames.join(', ')}`);
    lines.push('');
  }
  if (report.accuracyOverview) {
    lines.push(`【模型复盘】累计平均命中 ${report.accuracyOverview}`);
    lines.push('');
  }
  for (const pick of report.picks) {
    lines.push(formatPickLine(pick));
    lines.push(formatPickStats(pick));
    lines.push('');
  }
  if (aiExplanation?.trim()) {
    lines.push(aiExplanation.trim());
    lines.push('');
  } else {
    lines.push('【统计说明】号码由频率+遗漏+近期趋势综合打分，并根据历史命中自动调权。');
    lines.push('');
  }
  lines.push(report.disclaimer);
  return lines.join('\n').trim();
}

export async function saveDailyReport(
  db: LotteryDb,
  report: DailyReport,
  aiExplanation: string,
): Promise<void> {
  const model = db.models.get(REPORTS_TABLE);
  if (!model) return;
  const existing = await model.select().where({ date: report.date });
  if (Array.isArray(existing) && existing.length > 0) return;
  await model.insert({
    date: report.date,
    report_json: JSON.stringify(report),
    ai_explanation: aiExplanation,
    created_at: new Date().toISOString(),
  });
}

export async function loadTodayReport(db: LotteryDb, date = new Date()): Promise<DailyReport | null> {
  const model = db.models.get(REPORTS_TABLE);
  if (!model) return null;
  const dateStr = date.toISOString().slice(0, 10);
  const rows = (await model.select().where({ date: dateStr })) as Array<{
    report_json: string | DailyReport;
    ai_explanation: string;
  }>;
  if (!rows.length) return null;
  const row = rows[0];
  if (!row) return null;
  const report = parseStoredJson<DailyReport>(row.report_json, {
    date: dateStr,
    picks: [],
    disclaimer: '',
  });
  if (!report.picks?.length && !report.body?.trim()) return null;
  return report;
}

/** Today's pending rows as displayable picks (when report table is empty). */
export async function loadTodayPendingPicks(
  db: LotteryDb,
  gameIds: GameId[],
  date = new Date(),
): Promise<GamePick[]> {
  const today = date.toISOString().slice(0, 10);
  const picks: GamePick[] = [];
  for (const gameId of gameIds) {
    const pending = (await listPendingPredictions(db, gameId)) as Array<{
      predict_date: string;
      numbers: string | DrawNumbers;
      weights: string | ScoreWeights;
    }>;
    for (const row of pending.filter((p) => p.predict_date === today)) {
      picks.push({
        gameId,
        label: gameId,
        numbers: parseStoredJson<DrawNumbers>(row.numbers, {}),
        weights: parseStoredJson<ScoreWeights>(row.weights, DEFAULT_WEIGHTS),
        stats: { gameId, sampleSize: 0, hot: [], cold: [], detail: '' },
      });
    }
  }
  return picks;
}

/** Saved daily report, or reconstruct from today's pending picks. */
export async function resolveTodayReport(
  db: LotteryDb,
  gameIds: GameId[],
  date = new Date(),
): Promise<DailyReport | null> {
  const saved = await loadTodayReport(db, date);
  if (saved) return saved;
  const picks = await loadTodayPendingPicks(db, gameIds, date);
  if (!picks.length) return null;
  return {
    date: date.toISOString().slice(0, 10),
    picks,
    disclaimer: DISCLAIMER,
  };
}

/** Backfill missing pick weights from DB (saved reports may omit weights). */
export async function hydrateReportPickWeights(db: LotteryDb, picks: GamePick[]): Promise<GamePick[]> {
  const out: GamePick[] = [];
  for (const pick of picks) {
    if (pick.weights?.freq != null && pick.weights?.omit != null && pick.weights?.trend != null) {
      out.push(pick);
      continue;
    }
    out.push({ ...pick, weights: await loadGameWeights(db, pick.gameId) });
  }
  return out;
}
