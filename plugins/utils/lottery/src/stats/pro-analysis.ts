import { DEFAULT_WEIGHTS, type DrawNumbers, type GameId, type NormalizedDraw, type ScoreWeights } from '../types.js';

import { formatWeights, normalizeWeights } from './weights.js';
import { stableHash } from './engine.js';

const RECENT_WINDOW = 30;

export function affinityOfNumbers(
  nums: number[],
  freqMap: Map<number, number>,
  omitMap: Map<number, number>,
  trendMap: Map<number, number>,
): ScoreWeights {
  if (!nums.length) return { ...DEFAULT_WEIGHTS };
  let f = 0;
  let o = 0;
  let t = 0;
  for (const n of nums) {
    f += freqMap.get(n) ?? 0;
    o += omitMap.get(n) ?? 0;
    t += trendMap.get(n) ?? 0;
  }
  const div = nums.length;
  return normalizeWeights({ freq: f / div, omit: o / div, trend: t / div });
}

export function buildOmitMap(draws: number[][], poolMin: number, poolMax: number): Map<number, number> {
  const lastSeen = new Map<number, number>();
  for (let i = poolMin; i <= poolMax; i++) lastSeen.set(i, draws.length);
  draws.forEach((nums, idx) => {
    for (const n of nums) {
      if (n >= poolMin && n <= poolMax) lastSeen.set(n, idx);
    }
  });
  const maxOmit = Math.max(1, ...lastSeen.values());
  const out = new Map<number, number>();
  for (let i = poolMin; i <= poolMax; i++) out.set(i, (lastSeen.get(i) ?? 0) / maxOmit);
  return out;
}

export function buildFreqMap(draws: number[][], poolMin: number, poolMax: number): Map<number, number> {
  const freq = new Map<number, number>();
  for (let i = poolMin; i <= poolMax; i++) freq.set(i, 0);
  for (const row of draws) {
    for (const n of row) {
      if (n >= poolMin && n <= poolMax) freq.set(n, (freq.get(n) ?? 0) + 1);
    }
  }
  const max = Math.max(1, ...freq.values());
  for (const [k, v] of freq) freq.set(k, v / max);
  return freq;
}

export function computeProMetrics(
  gameId: GameId,
  pick: number[],
  draws: NormalizedDraw[],
  weights: ScoreWeights,
  poolMin?: number,
  poolMax?: number,
  mid?: number,
): import('../types.js').ProMetrics {
  const odd = pick.filter((n) => n % 2 === 1).length;
  const even = pick.length - odd;
  const m = mid ?? (poolMax && poolMin ? Math.floor((poolMin + poolMax) / 2) : 5);
  const big = pick.filter((n) => n > m).length;
  const small = pick.length - big;
  const sum = pick.reduce((a, b) => a + b, 0);
  const span = pick.length ? Math.max(...pick) - Math.min(...pick) : 0;

  let zones: string | undefined;
  if (poolMin != null && poolMax != null && gameId !== 'fc3d' && gameId !== 'pl3' && gameId !== 'pl5') {
    const size = Math.ceil((poolMax - poolMin + 1) / 3);
    const z = [0, 0, 0];
    for (const n of pick) {
      const idx = Math.min(2, Math.floor((n - poolMin) / size));
      z[idx] = (z[idx] ?? 0) + 1;
    }
    zones = `三区 ${z.join(':')}`;
  }

  const rows = draws.map((d) => extractFlat(d.numbers, gameId)).filter((a) => a.length);
  const recent = rows.slice(0, 10).flat();
  const freq = new Map<number, number>();
  for (const n of recent) freq.set(n, (freq.get(n) ?? 0) + 1);
  const recentHot = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || stableHash(`hot:${a[0]}`) - stableHash(`hot:${b[0]}`))
    .slice(0, 5)
    .map(([n]) => String(n))
    .join(',');

  return {
    oddEven: `奇偶 ${odd}:${even}`,
    bigSmall: `大小 ${big}:${small}`,
    sum,
    span,
    zones,
    recentHot: recentHot ? `近10期热号 ${recentHot}` : '',
    modelWeights: `权重 ${formatWeights(weights)}`,
  };
}

export function computeDigitProMetrics(
  digits: number[],
  draws: NormalizedDraw[],
  weights: ScoreWeights,
): import('../types.js').ProMetrics {
  const sum = digits.reduce((a, b) => a + b, 0);
  const span = digits.length ? Math.max(...digits) - Math.min(...digits) : 0;
  const posHints: string[] = [];
  const rows = draws.map((d) => d.numbers.digits ?? []).filter((a) => a.length);
  for (let pos = 0; pos < digits.length; pos++) {
    const col = rows.map((r) => r[pos]).filter((n) => n !== undefined);
    const freq = new Map<number, number>();
    for (let d = 0; d <= 9; d++) freq.set(d, 0);
    col.slice(0, RECENT_WINDOW).forEach((n) => freq.set(n, (freq.get(n) ?? 0) + 1));
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => d);
    posHints.push(`第${pos + 1}位[${top.join(',')}]`);
  }
  return {
    oddEven: '',
    bigSmall: '',
    sum,
    span,
    digitPos: posHints.join(' '),
    recentHot: '',
    modelWeights: `权重 ${formatWeights(weights)}`,
  };
}

function extractFlat(n: DrawNumbers, gameId: GameId): number[] {
  if (gameId === 'kl8') return n.main ?? [];
  if (gameId === 'ssq') return n.red ?? [];
  if (gameId === 'dlt') return n.front ?? [];
  return n.digits ?? [];
}
