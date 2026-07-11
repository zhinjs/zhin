import { DEFAULT_WEIGHTS, type ScoreWeights } from '../types.js';

import { normalizeWeights } from './weights.js';

const RECENT_WINDOW = 30;

export function analyzePoolTrend(draws: number[][], poolMin: number, poolMax: number): Map<number, number> {
  const recent = draws.slice(0, RECENT_WINDOW);
  const freq = new Map<number, number>();
  for (let i = poolMin; i <= poolMax; i++) freq.set(i, 0);
  for (const row of recent) {
    for (const n of row) {
      if (n >= poolMin && n <= poolMax) freq.set(n, (freq.get(n) ?? 0) + 1);
    }
  }
  const max = Math.max(1, ...freq.values());
  for (const [k, v] of freq) freq.set(k, v / max);
  return freq;
}

export function parseNumberList(raw: string | undefined | null): number[] {
  if (!raw) return [];
  return raw
    .split(/[,，\s+|]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n));
}

export function stableHash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h;
}

export interface PoolScore {
  value: number;
  freq: number;
  omit: number;
  trend: number;
  score: number;
}

/** 号码池：频率 + 遗漏 + 近期趋势 综合打分 */
export function scorePool(
  draws: number[][],
  poolMin: number,
  poolMax: number,
  tieSeed: string,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): PoolScore[] {
  const w = normalizeWeights(weights);
  const freq = new Map<number, number>();
  const lastSeen = new Map<number, number>();
  for (let i = poolMin; i <= poolMax; i++) {
    freq.set(i, 0);
    lastSeen.set(i, draws.length);
  }
  draws.forEach((nums, idx) => {
    for (const n of nums) {
      if (n < poolMin || n > poolMax) continue;
      freq.set(n, (freq.get(n) ?? 0) + 1);
      lastSeen.set(n, idx);
    }
  });
  const trend = analyzePoolTrend(draws, poolMin, poolMax);
  const maxFreq = Math.max(1, ...freq.values());
  const maxOmit = Math.max(1, ...lastSeen.values());
  const scores: PoolScore[] = [];
  for (let v = poolMin; v <= poolMax; v++) {
    const f = (freq.get(v) ?? 0) / maxFreq;
    const o = (lastSeen.get(v) ?? 0) / maxOmit;
    const t = trend.get(v) ?? 0;
    scores.push({
      value: v,
      freq: f,
      omit: o,
      trend: t,
      score: f * w.freq + o * w.omit + t * w.trend,
    });
  }
  scores.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return stableHash(`${tieSeed}:${a.value}`) - stableHash(`${tieSeed}:${b.value}`);
  });
  return scores;
}

export function pickTopUnique(scores: PoolScore[], count: number): number[] {
  return scores.slice(0, count).map((s) => s.value).sort((a, b) => a - b);
}

/** 定位胆：每位 0-9 独立打分（含近期趋势） */
export function scoreDigits(
  draws: number[][],
  positions: number,
  tieSeed: string,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): number[] {
  const w = normalizeWeights(weights);
  const picks: number[] = [];
  for (let pos = 0; pos < positions; pos++) {
    const column = draws.map((d) => d[pos]).filter((n) => n !== undefined);
    const recent = column.slice(0, 30);
    const freq = new Map<number, number>();
    const lastSeen = new Map<number, number>();
    const trend = new Map<number, number>();
    for (let i = 0; i <= 9; i++) {
      freq.set(i, 0);
      lastSeen.set(i, column.length);
      trend.set(i, 0);
    }
    column.forEach((n, idx) => {
      freq.set(n, (freq.get(n) ?? 0) + 1);
      lastSeen.set(n, idx);
    });
    recent.forEach((n) => trend.set(n, (trend.get(n) ?? 0) + 1));
    const maxFreq = Math.max(1, ...freq.values());
    const maxOmit = Math.max(1, ...lastSeen.values());
    const maxTrend = Math.max(1, ...trend.values());
    let best = 0;
    let bestScore = -1;
    for (let d = 0; d <= 9; d++) {
      const f = (freq.get(d) ?? 0) / maxFreq;
      const o = (lastSeen.get(d) ?? 0) / maxOmit;
      const t = (trend.get(d) ?? 0) / maxTrend;
      const score = f * w.freq + o * w.omit + t * w.trend;
      if (score > bestScore || (score === bestScore && stableHash(`${tieSeed}:${pos}:${d}`) < stableHash(`${tieSeed}:${pos}:${best}`))) {
        bestScore = score;
        best = d;
      }
    }
    picks.push(best);
  }
  return picks;
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
