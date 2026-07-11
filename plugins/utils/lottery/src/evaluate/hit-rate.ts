import { DEFAULT_WEIGHTS, type DrawNumbers, type GameId, type GamePick, type HitSummary, type NormalizedDraw, type ScoreWeights } from '../types.js';

import {
  affinityOfNumbers,
  buildFreqMap,
  buildOmitMap,
} from '../stats/pro-analysis.js';
import { analyzePoolTrend } from '../stats/engine.js';
import { mergeWeights } from '../stats/weights.js';

function intersectCount(a: number[], b: number[]): number {
  const set = new Set(b);
  return a.filter((n) => set.has(n)).length;
}

function digitPositionHits(pick: number[], actual: number[]): { hits: number; total: number } {
  const total = Math.min(pick.length, actual.length);
  let hits = 0;
  for (let i = 0; i < total; i++) {
    if (pick[i] === actual[i]) hits++;
  }
  return { hits, total };
}

export function comparePickToDraw(pick: GamePick, draw: NormalizedDraw): HitSummary {
  const n = pick.numbers;
  const a = draw.numbers;
  switch (pick.gameId) {
    case 'kl8': {
      const p = n.main ?? [];
      const act = a.main ?? [];
      const hits = intersectCount(p, act);
      return {
        total: p.length,
        hits,
        rate: p.length ? hits / p.length : 0,
        detail: `命中 ${hits}/${p.length}`,
      };
    }
    case 'ssq': {
      const redHits = intersectCount(n.red ?? [], a.red ?? []);
      const blueHit = (n.blue?.[0] != null && a.blue?.includes(n.blue[0])) ? 1 : 0;
      const total = 7;
      const hits = redHits + blueHit;
      return {
        total,
        hits,
        rate: hits / total,
        detail: `红${redHits}/6 蓝${blueHit}/1`,
      };
    }
    case 'dlt': {
      const fHits = intersectCount(n.front ?? [], a.front ?? []);
      const bHits = intersectCount(n.back ?? [], a.back ?? []);
      const total = 7;
      const hits = fHits + bHits;
      return {
        total,
        hits,
        rate: hits / total,
        detail: `前${fHits}/5 后${bHits}/2`,
      };
    }
    case 'fc3d':
    case 'pl3':
    case 'pl5': {
      const { hits, total } = digitPositionHits(n.digits ?? [], a.digits ?? []);
      return {
        total,
        hits,
        rate: total ? hits / total : 0,
        detail: `定位 ${hits}/${total}`,
      };
    }
    default:
      return { total: 0, hits: 0, rate: 0, detail: '未知玩法' };
  }
}

/** 根据开奖结果反推更优权重方向，用于渐进调优 */
export function tuneWeightsFromDraw(
  current: ScoreWeights,
  pick: DrawNumbers,
  actual: DrawNumbers,
  gameId: GameId,
  draws: NormalizedDraw[],
): ScoreWeights {
  const rows = draws.map((d) => flatNumbers(d.numbers, gameId)).filter((r) => r.length);
  if (!rows.length) return current;

  const ranges = poolRange(gameId);
  if (!ranges) {
    return current;
  }
  const { min, max } = ranges;
  const freqMap = buildFreqMap(rows, min, max);
  const omitMap = buildOmitMap(rows, min, max);
  const trendMap = analyzePoolTrend(rows, min, max);
  const actualNums = flatNumbers(actual, gameId);
  const actualAff = affinityOfNumbers(actualNums, freqMap, omitMap, trendMap);
  return mergeWeights(current, actualAff, 0.04);
}

function flatNumbers(n: DrawNumbers, gameId: GameId): number[] {
  if (gameId === 'kl8') return n.main ?? [];
  if (gameId === 'ssq') return [...(n.red ?? []), ...(n.blue ?? [])];
  if (gameId === 'dlt') return [...(n.front ?? []), ...(n.back ?? [])];
  return n.digits ?? [];
}

function poolRange(gameId: GameId): { min: number; max: number } | null {
  switch (gameId) {
    case 'kl8':
      return { min: 1, max: 80 };
    case 'ssq':
      return { min: 1, max: 33 };
    case 'dlt':
      return { min: 1, max: 35 };
    case 'fc3d':
    case 'pl3':
    case 'pl5':
      return { min: 0, max: 9 };
    default:
      return null;
  }
}

export function formatHitSummary(gameId: GameId, hit: HitSummary, issue: string): string {
  return `${gameId} 第${issue}期 ${hit.detail} (${(hit.rate * 100).toFixed(0)}%)`;
}

export { DEFAULT_WEIGHTS };
