import { DEFAULT_WEIGHTS, type ScoreWeights } from '../types.js';

export function normalizeWeights(w: ScoreWeights | undefined): ScoreWeights {
  const src = w ?? DEFAULT_WEIGHTS;
  const freq = Math.max(0.1, src.freq);
  const omit = Math.max(0.1, src.omit);
  const trend = Math.max(0.1, src.trend);
  const sum = freq + omit + trend;
  return { freq: freq / sum, omit: omit / sum, trend: trend / sum };
}

export function formatWeights(w: ScoreWeights | undefined): string {
  const n = normalizeWeights(w);
  return `F${Math.round(n.freq * 100)} O${Math.round(n.omit * 100)} T${Math.round(n.trend * 100)}`;
}

export function clampWeight(v: number, min = 0.1, max = 0.6): number {
  return Math.min(max, Math.max(min, v));
}

export function mergeWeights(current: ScoreWeights, target: ScoreWeights, lr = 0.05): ScoreWeights {
  return normalizeWeights({
    freq: clampWeight(current.freq + lr * (target.freq - current.freq)),
    omit: clampWeight(current.omit + lr * (target.omit - current.omit)),
    trend: clampWeight(current.trend + lr * (target.trend - current.trend)),
  });
}

export { DEFAULT_WEIGHTS };
