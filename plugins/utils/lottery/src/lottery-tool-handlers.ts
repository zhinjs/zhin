import type { GameId } from './types.js';

import { parseGameId } from './games/registry.js';
import { loadDraws } from './db.js';
import { recommendGame } from './recommend/game-pick.js';
import {
  loadGameWeights,
  loadAccuracySnapshot,
  savePrediction,
  listPendingPredictions,
} from './evaluate/tracker.js';
import type { LotteryRuntime } from './runtime-state.js';
import { lotteryKl8 } from './config.js';

export async function handleGetModelState(runtime: LotteryRuntime, game?: string): Promise<string> {
  const { db } = runtime;
  const gid = parseGameId(game ?? '');
  const ids: readonly GameId[] = gid ? [gid] : runtime.enabledGames;
  const out = [];
  for (const id of ids) {
    const w = await loadGameWeights(db, id);
    const acc = await loadAccuracySnapshot(db, id);
    out.push({ gameId: id, weights: w, accuracy: acc ?? null });
  }
  return JSON.stringify(out);
}

export async function handleComputeRecommend(runtime: LotteryRuntime, game: string): Promise<string> {
  const gid = parseGameId(game);
  if (!gid) return 'invalid game';
  const { db, config: cfg } = runtime;
  const kl8 = lotteryKl8(cfg);
  const draws = await loadDraws(db, gid, cfg.historyLimit);
  if (!draws.length) return 'no data; run the lottery draw synchronization tool first';
  const pick = recommendGame(gid, draws, {
    pickCount: gid === 'kl8' ? kl8.pickCount : cfg.pickCount,
    tieSeed: new Date().toISOString().slice(0, 10),
    weights: await loadGameWeights(db, gid),
    accuracy: await loadAccuracySnapshot(db, gid),
    kl8: gid === 'kl8' ? kl8 : undefined,
  });
  return JSON.stringify(pick);
}

export async function handleSavePrediction(runtime: LotteryRuntime, game: string, numbersJson: string): Promise<string> {
  const gid = parseGameId(game);
  if (!gid) return 'invalid game';
  const { db } = runtime;
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

export async function handleListPending(runtime: LotteryRuntime, game?: string): Promise<string> {
  const { db } = runtime;
  const gid = parseGameId(game ?? '');
  return JSON.stringify(await listPendingPredictions(db, gid ?? undefined));
}

export async function handleStatsSnapshot(runtime: LotteryRuntime, game: string): Promise<string> {
  const gid = parseGameId(game);
  if (!gid) return 'invalid game';
  const { db, config: cfg } = runtime;
  const kl8 = lotteryKl8(cfg);
  const draws = await loadDraws(db, gid, Math.min(30, cfg.historyLimit));
  const pick = recommendGame(gid, draws, {
    pickCount: gid === 'kl8' ? kl8.pickCount : cfg.pickCount,
    tieSeed: 'snapshot',
    weights: await loadGameWeights(db, gid),
    accuracy: await loadAccuracySnapshot(db, gid),
    kl8: gid === 'kl8' ? kl8 : undefined,
  });
  return JSON.stringify({ sample: draws.length, pick, recentDraws: draws.slice(0, 5) });
}
