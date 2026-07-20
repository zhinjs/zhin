import { DISCLAIMER, type GameId } from './types.js';

import { parseGameId } from './games/registry.js';
import { loadDraws } from './db.js';
import { recommendGame } from './recommend/game-pick.js';
import {
  loadGameWeights,
  saveGameWeights,
  loadAccuracySnapshot,
  savePrediction,
  listPendingPredictions,
  submitAgentReview,
  saveAgentMemory,
  loadAgentMemory,
} from './evaluate/tracker.js';
import { saveDailyReport } from './recommend/report.js';
import { pushLotteryReport, getLotteryOutboundPush } from './push.js';
import { normalizeWeights } from './stats/weights.js';
import { getLotteryAgentDeps } from './lottery-agent-deps.js';

export async function handleGetModelState(game?: string): Promise<string> {
  const deps = getLotteryAgentDeps();
  const db = deps.getDb();
  if (!db) return 'db not ready';
  const gid = parseGameId(game ?? '');
  const ids: GameId[] = gid ? [gid] : deps.enabledGames();
  const out = [];
  for (const id of ids) {
    const w = await loadGameWeights(db, id);
    const acc = await loadAccuracySnapshot(db, id);
    out.push({ gameId: id, weights: w, accuracy: acc ?? null });
  }
  return JSON.stringify(out);
}

export async function handleComputeRecommend(game: string): Promise<string> {
  const deps = getLotteryAgentDeps();
  const gid = parseGameId(game);
  if (!gid) return 'invalid game';
  const db = deps.getDb();
  if (!db) return 'db not ready';
  const cfg = deps.getConfig();
  const draws = await loadDraws(db, gid, cfg.historyLimit);
  if (!draws.length) return 'no data, run lottery_sync first';
  const pick = recommendGame(gid, draws, {
    pickCount: gid === 'kl8' ? cfg.kl8.pickCount : cfg.pickCount,
    tieSeed: new Date().toISOString().slice(0, 10),
    weights: await loadGameWeights(db, gid),
    accuracy: await loadAccuracySnapshot(db, gid),
    kl8: gid === 'kl8' ? cfg.kl8 : undefined,
  });
  return JSON.stringify(pick);
}

export async function handleSavePrediction(game: string, numbersJson: string): Promise<string> {
  const deps = getLotteryAgentDeps();
  const gid = parseGameId(game);
  if (!gid) return 'invalid game';
  const db = deps.getDb();
  if (!db) return 'db not ready';
  const numbers = JSON.parse(numbersJson);
  const weights = await loadGameWeights(db, gid);
  await savePrediction(db, {
    gameId: gid,
    label: gid,
    numbers,
    weights,
    stats: { gameId: gid, sampleSize: 0, hot: [], cold: [], detail: '' },
  });
  return JSON.stringify({ ok: true, gameId: gid });
}

export async function handleListPending(game?: string): Promise<string> {
  const deps = getLotteryAgentDeps();
  const db = deps.getDb();
  if (!db) return 'db not ready';
  const gid = parseGameId(game ?? '');
  return JSON.stringify(await listPendingPredictions(db, gid ?? undefined));
}

export async function handleSubmitReview(input: {
  game: string;
  predict_at: string;
  actual_issue: string;
  actual_numbers_json: string;
  analysis: string;
}): Promise<string> {
  const deps = getLotteryAgentDeps();
  const gid = parseGameId(input.game);
  if (!gid) return 'invalid game';
  const db = deps.getDb();
  if (!db) return 'db not ready';
  const hit = await submitAgentReview(
    db,
    {
      gameId: gid,
      predictAt: input.predict_at,
      actualIssue: input.actual_issue,
      actualNumbers: JSON.parse(input.actual_numbers_json),
      analysis: input.analysis ?? '',
    },
    deps.getConfig().historyLimit,
  );
  return hit ? JSON.stringify(hit) : 'pending not found';
}

export async function handleSetWeights(game: string, freq: number, omit: number, trend: number): Promise<string> {
  const deps = getLotteryAgentDeps();
  const gid = parseGameId(game);
  if (!gid) return 'invalid game';
  const db = deps.getDb();
  if (!db) return 'db not ready';
  const w = normalizeWeights({ freq, omit, trend });
  const snap = await loadAccuracySnapshot(db, gid);
  await saveGameWeights(db, gid, w, snap?.evalCount ?? 0, snap?.avgHitRate ?? 0);
  return JSON.stringify({ ok: true, weights: w });
}

export async function handleSaveMemory(content: string, memoryType?: string, game?: string): Promise<string> {
  const deps = getLotteryAgentDeps();
  const db = deps.getDb();
  if (!db) return 'db not ready';
  const gid = parseGameId(game ?? '');
  await saveAgentMemory(db, content, memoryType || 'insight', gid ?? '');
  return JSON.stringify({ ok: true });
}

export async function handleGetMemory(game?: string, limit?: number): Promise<string> {
  const deps = getLotteryAgentDeps();
  const db = deps.getDb();
  if (!db) return 'db not ready';
  const gid = parseGameId(game ?? '');
  const lim = Math.min(50, limit || 20);
  return JSON.stringify(await loadAgentMemory(db, gid ?? undefined, lim));
}

export async function handlePublishReport(content: string, push?: boolean): Promise<string> {
  const deps = getLotteryAgentDeps();
  const db = deps.getDb();
  if (!db) return 'db not ready';
  const text = content.trim();
  if (!text.includes(DISCLAIMER)) return 'content must include disclaimer';
  const date = new Date().toISOString().slice(0, 10);
  await saveDailyReport(db, { date, picks: [] as never[], disclaimer: DISCLAIMER, body: text }, text);
  const doPush = push === true && Boolean(getLotteryOutboundPush());
  if (doPush) await pushLotteryReport(text);
  return JSON.stringify({ ok: true, date, pushed: doPush });
}

export async function handleStatsSnapshot(game: string): Promise<string> {
  const deps = getLotteryAgentDeps();
  const gid = parseGameId(game);
  if (!gid) return 'invalid game';
  const db = deps.getDb();
  if (!db) return 'db not ready';
  const cfg = deps.getConfig();
  const draws = await loadDraws(db, gid, Math.min(30, cfg.historyLimit));
  const pick = recommendGame(gid, draws, {
    pickCount: gid === 'kl8' ? cfg.kl8.pickCount : cfg.pickCount,
    tieSeed: 'snapshot',
    weights: await loadGameWeights(db, gid),
    accuracy: await loadAccuracySnapshot(db, gid),
    kl8: gid === 'kl8' ? cfg.kl8 : undefined,
  });
  return JSON.stringify({ sample: draws.length, pick, recentDraws: draws.slice(0, 5) });
}
