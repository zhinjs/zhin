import { DEFAULT_WEIGHTS, type DrawNumbers, type GameId, type GamePick, type HitSummary, type NormalizedDraw, type ScoreWeights, type AccuracySnapshot } from '../types.js';

import { loadDraws, parseStoredJson, type LotteryDb } from '../db.js';

import { comparePickToDraw, tuneWeightsFromDraw, formatHitSummary } from './hit-rate.js';
import { formatWeights, normalizeWeights } from '../stats/weights.js';

export const PREDICTIONS_TABLE = 'lottery_predictions';
export const WEIGHTS_TABLE = 'lottery_model_weights';
export const MEMORY_TABLE = 'lottery_agent_memory';

export function defineEvalTables(db: { define: (name: string, schema: Record<string, unknown>) => void }): void {
  db.define(PREDICTIONS_TABLE, {
    game_id: { type: 'text', nullable: false },
    predict_at: { type: 'text', nullable: false },
    predict_date: { type: 'text', default: '' },
    numbers: { type: 'text', default: '{}' },
    weights: { type: 'text', default: '{}' },
    status: { type: 'text', default: 'pending' },
    actual_issue: { type: 'text', default: '' },
    actual_numbers: { type: 'text', default: '' },
    hit_summary: { type: 'text', default: '' },
    analysis: { type: 'text', default: '' },
    evaluated_at: { type: 'text', default: '' },
  });
  db.define(WEIGHTS_TABLE, {
    game_id: { type: 'text', nullable: false },
    freq_weight: { type: 'text', default: '0.4' },
    omit_weight: { type: 'text', default: '0.35' },
    trend_weight: { type: 'text', default: '0.25' },
    eval_count: { type: 'text', default: '0' },
    avg_hit_rate: { type: 'text', default: '0' },
    updated_at: { type: 'text', default: '' },
  });
  db.define(MEMORY_TABLE, {
    game_id: { type: 'text', default: '' },
    memory_type: { type: 'text', default: 'insight' },
    content: { type: 'text', default: '' },
    created_at: { type: 'text', default: '' },
  });
}

export async function loadGameWeights(db: LotteryDb, gameId: GameId): Promise<ScoreWeights> {
  const model = db.models.get(WEIGHTS_TABLE);
  if (!model) return { ...DEFAULT_WEIGHTS };
  const rows = (await model.select().where({ game_id: gameId })) as Array<{
    freq_weight: string;
    omit_weight: string;
    trend_weight: string;
  }>;
  if (!rows.length) return { ...DEFAULT_WEIGHTS };
  const r = rows[0];
  if (!r) return { ...DEFAULT_WEIGHTS };
  return {
    freq: Number.parseFloat(r.freq_weight) || DEFAULT_WEIGHTS.freq,
    omit: Number.parseFloat(r.omit_weight) || DEFAULT_WEIGHTS.omit,
    trend: Number.parseFloat(r.trend_weight) || DEFAULT_WEIGHTS.trend,
  };
}

export async function hasWeightsRow(db: LotteryDb, gameId: GameId): Promise<boolean> {
  const model = db.models.get(WEIGHTS_TABLE);
  if (!model) return false;
  const rows = (await model.select().where({ game_id: gameId })) as unknown[];
  return rows.length > 0;
}

export async function saveGameWeights(
  db: LotteryDb,
  gameId: GameId,
  weights: ScoreWeights,
  evalCount: number,
  avgHitRate: number,
): Promise<void> {
  const model = db.models.get(WEIGHTS_TABLE);
  if (!model) return;
  const normalized = normalizeWeights(weights);
  const existing = (await model.select().where({ game_id: gameId })) as unknown[];
  const row = {
    game_id: gameId,
    freq_weight: String(normalized.freq),
    omit_weight: String(normalized.omit),
    trend_weight: String(normalized.trend),
    eval_count: String(evalCount),
    avg_hit_rate: String(avgHitRate),
    updated_at: new Date().toISOString(),
  };
  if (existing.length) await model.delete().where({ game_id: gameId });
  await model.insert(row);
}

export async function loadAccuracySnapshot(db: LotteryDb, gameId: GameId): Promise<AccuracySnapshot | undefined> {
  const model = db.models.get(WEIGHTS_TABLE);
  const predModel = db.models.get(PREDICTIONS_TABLE);
  if (!model || !predModel) return undefined;
  const wrows = (await model.select().where({ game_id: gameId })) as Array<{
    eval_count: string;
    avg_hit_rate: string;
  }>;
  const evalCount = Number.parseInt(wrows[0]?.eval_count ?? '0', 10) || 0;
  const avgHitRate = Number.parseFloat(wrows[0]?.avg_hit_rate ?? '0') || 0;
  const preds = (await predModel.select().where({ game_id: gameId, status: 'evaluated' })) as Array<{
    hit_summary: string | HitSummary;
    evaluated_at: string;
  }>;
  const recent = [...preds]
    .sort((a, b) => (b.evaluated_at ?? '').localeCompare(a.evaluated_at ?? ''))
    .slice(0, 5)
    .map((p) => {
      const h = parseStoredJson<HitSummary>(p.hit_summary, { total: 0, hits: 0, rate: 0, detail: '-' });
      return `${(h.rate * 100).toFixed(0)}%`;
    });
  if (!evalCount) return undefined;
  return { evalCount, avgHitRate, recent5: recent.length ? recent.join(',') : '-' };
}

export async function cancelTodayPendingPredictions(
  db: LotteryDb,
  gameId: GameId,
  date = new Date(),
): Promise<void> {
  const model = db.models.get(PREDICTIONS_TABLE);
  if (!model) return;
  const today = date.toISOString().slice(0, 10);
  const pending = (await listPendingPredictions(db, gameId)) as Array<{ predict_at: string; predict_date: string }>;
  for (const row of pending.filter((p) => p.predict_date === today)) {
    await model.delete().where({ game_id: gameId, predict_at: row.predict_at, status: 'pending' });
  }
}

export async function savePrediction(db: LotteryDb, pick: GamePick, at = new Date()): Promise<void> {
  const model = db.models.get(PREDICTIONS_TABLE);
  if (!model) return;
  await model.insert({
    game_id: pick.gameId,
    predict_at: at.toISOString(),
    predict_date: at.toISOString().slice(0, 10),
    numbers: JSON.stringify(pick.numbers),
    weights: JSON.stringify(pick.weights),
    status: 'pending',
    actual_issue: '',
    actual_numbers: '',
    hit_summary: '',
    analysis: '',
    evaluated_at: '',
  });
}

export async function listPendingPredictions(db: LotteryDb, gameId?: GameId): Promise<unknown[]> {
  const model = db.models.get(PREDICTIONS_TABLE);
  if (!model) return [];
  if (gameId) {
    return model.select().where({ game_id: gameId, status: 'pending' });
  }
  const all = (await model.select().where({ status: 'pending' })) as unknown[];
  return all;
}

export async function submitAgentReview(
  db: LotteryDb,
  input: {
    gameId: GameId;
    predictAt: string;
    actualIssue: string;
    actualNumbers: DrawNumbers;
    analysis: string;
    adjustWeights?: boolean;
  },
  historyLimit: number,
): Promise<HitSummary | null> {
  const predModel = db.models.get(PREDICTIONS_TABLE);
  if (!predModel) return null;
  const pending = (await predModel.select().where({
    game_id: input.gameId,
    predict_at: input.predictAt,
    status: 'pending',
  })) as Array<{ numbers: string | DrawNumbers; weights: string | ScoreWeights }>;
  if (!pending.length) return null;

  const row = pending[0];
  if (!row) return null;
  const pick: GamePick = {
    gameId: input.gameId,
    label: '',
    numbers: parseStoredJson<DrawNumbers>(row.numbers, {}),
    weights: parseStoredJson<ScoreWeights>(row.weights, DEFAULT_WEIGHTS),
    stats: { gameId: input.gameId, sampleSize: 0, hot: [], cold: [], detail: '' },
  };
  const draw: NormalizedDraw = {
    gameId: input.gameId,
    issue: input.actualIssue,
    drawTime: '',
    numbers: input.actualNumbers,
    source: 'fucai',
  };
  const hit = comparePickToDraw(pick, draw);
  const history = await loadDraws(db, input.gameId, historyLimit);
  const analysis = input.analysis.trim() || formatHitSummary(input.gameId, hit, input.actualIssue);

  let evalCount = 0;
  let avgHitRate = 0;
  const wrows = (await db.models.get(WEIGHTS_TABLE)?.select().where({ game_id: input.gameId }) ?? []) as Array<{
    eval_count: string;
    avg_hit_rate: string;
  }>;
  if (wrows[0]) {
    evalCount = Number.parseInt(wrows[0].eval_count, 10) || 0;
    avgHitRate = Number.parseFloat(wrows[0].avg_hit_rate) || 0;
  }
  evalCount++;
  avgHitRate = avgHitRate + (hit.rate - avgHitRate) / evalCount;

  let weights = pick.weights;
  if (input.adjustWeights !== false) {
    weights = tuneWeightsFromDraw(weights, pick.numbers, draw.numbers, input.gameId, history);
  }

  await predModel.delete().where({ game_id: input.gameId, predict_at: input.predictAt, status: 'pending' });
  await predModel.insert({
    game_id: input.gameId,
    predict_at: input.predictAt,
    predict_date: input.predictAt.slice(0, 10),
    numbers: JSON.stringify(pick.numbers),
    weights: JSON.stringify(pick.weights),
    status: 'evaluated',
    actual_issue: input.actualIssue,
    actual_numbers: JSON.stringify(input.actualNumbers),
    hit_summary: JSON.stringify(hit),
    analysis: analysis,
    evaluated_at: new Date().toISOString(),
  });
  await saveGameWeights(db, input.gameId, weights, evalCount, avgHitRate);
  return hit;
}

export async function saveAgentMemory(
  db: LotteryDb,
  content: string,
  memoryType = 'insight',
  gameId = '',
): Promise<void> {
  const model = db.models.get(MEMORY_TABLE);
  if (!model || !content.trim()) return;
  await model.insert({
    game_id: gameId,
    memory_type: memoryType,
    content: content.trim(),
    created_at: new Date().toISOString(),
  });
}

export async function loadAgentMemory(db: LotteryDb, gameId?: string, limit = 20): Promise<unknown[]> {
  const model = db.models.get(MEMORY_TABLE);
  if (!model) return [];
  let rows: unknown[] = [];
  if (gameId) {
    rows = (await model.select().where({ game_id: gameId })) as unknown[];
  } else {
    const games: Array<GameId | ''> = ['kl8', 'ssq', 'dlt', 'fc3d', 'pl3', 'pl5', ''];
    for (const g of games) {
      const part = (await model.select().where({ game_id: g })) as unknown[];
      rows.push(...part);
    }
  }
  return [...rows]
    .sort((a, b) => String((b as { created_at?: string }).created_at ?? '').localeCompare(String((a as { created_at?: string }).created_at ?? '')))
    .slice(0, limit);
}

export async function formatReviewReport(db: LotteryDb, gameId?: GameId): Promise<string> {
  const predModel = db.models.get(PREDICTIONS_TABLE);
  const memModel = db.models.get(MEMORY_TABLE);
  if (!predModel) return '数据库未就绪';
  const games: GameId[] = gameId ? [gameId] : ['kl8', 'ssq', 'dlt', 'fc3d', 'pl3', 'pl5'];
  const lines = ['【彩票推荐复盘】', ''];
  for (const gid of games) {
    const weights = await loadGameWeights(db, gid);
    const snap = await loadAccuracySnapshot(db, gid);
    const preds = (await predModel.select().where({ game_id: gid, status: 'evaluated' })) as Array<{
      actual_issue: string;
      hit_summary: string | HitSummary;
      analysis: string;
      evaluated_at: string;
    }>;
    const recent = [...preds]
      .sort((a, b) => (b.evaluated_at ?? '').localeCompare(a.evaluated_at ?? ''))
      .slice(0, 5);
    lines.push(`■ ${gid} 模型 ${formatWeights(weights)}`);
    if (snap) {
      lines.push(`  累计 ${snap.evalCount} 期 平均命中 ${(snap.avgHitRate * 100).toFixed(1)}%`);
    } else {
      lines.push('  尚无复盘数据');
    }
    for (const p of recent) {
      const h = parseStoredJson<HitSummary>(p.hit_summary, { total: 0, hits: 0, rate: 0, detail: '-' });
      lines.push(`  第${p.actual_issue}期 ${h.detail} (${(h.rate * 100).toFixed(0)}%)`);
      if (p.analysis?.trim()) lines.push(`    ${p.analysis.trim()}`);
    }
    lines.push('');
  }
  if (memModel) {
    const mem = await loadAgentMemory(db, gameId, 5);
    if (mem.length) {
      lines.push('【Agent 记忆】');
      for (const m of mem as Array<{ game_id?: string; content?: string; memory_type?: string }>) {
        lines.push(`- [${m.game_id || 'global'}/${m.memory_type}] ${m.content}`);
      }
    }
  }
  return lines.join('\n').trim();
}
