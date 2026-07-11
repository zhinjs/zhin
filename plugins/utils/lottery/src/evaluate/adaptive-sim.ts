import { DEFAULT_WEIGHTS, type DrawNumbers, type GameId, type GamePick, type NormalizedDraw, type ScoreWeights } from '../types.js';

import { comparePickToDraw, tuneWeightsFromDraw } from './hit-rate.js';
import { recommendGame } from '../recommend/game-pick.js';

export interface SimulationOptions {
  pickCount: number;
  minHistory: number;
  randomTrials: number;
  initialWeights?: ScoreWeights;
  adaptive?: boolean;
  /** Score only the last N periods; omit to score every training step. */
  scoreWindow?: number;
}

export interface SimulationResult {
  gameId: GameId;
  periods: number;
  warmupPeriods: number;
  adaptiveAvgHitRate: number;
  fixedAvgHitRate: number;
  randomAvgHitRate: number;
  adaptiveVsRandom: number;
  adaptiveVsFixed: number;
  initialWeights: ScoreWeights;
  finalWeights: ScoreWeights;
  firstScoredIssue: string;
  lastScoredIssue: string;
}

const EMPTY_STATS: GamePick['stats'] = {
  gameId: 'kl8',
  sampleSize: 0,
  hot: [],
  cold: [],
  detail: '',
};

function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickUnique(rng: () => number, min: number, max: number, count: number): number[] {
  const pool = [];
  for (let i = min; i <= max; i++) pool.push(i);
  const out: number[] = [];
  for (let i = 0; i < count && pool.length; i++) {
    const idx = Math.floor(rng() * pool.length);
    const picked = pool.splice(idx, 1)[0];
    if (picked !== undefined) out.push(picked);
  }
  return out.sort((a, b) => a - b);
}

function pickDigits(rng: () => number, len: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < len; i++) out.push(Math.floor(rng() * 10));
  return out;
}

export function randomDrawNumbers(gameId: GameId, pickCount: number, rng: () => number): DrawNumbers {
  switch (gameId) {
    case 'kl8':
      return { main: pickUnique(rng, 1, 80, Math.min(10, Math.max(1, pickCount))) };
    case 'ssq':
      return { red: pickUnique(rng, 1, 33, 6), blue: pickUnique(rng, 1, 16, 1) };
    case 'dlt':
      return { front: pickUnique(rng, 1, 35, 5), back: pickUnique(rng, 1, 12, 2) };
    case 'fc3d':
    case 'pl3':
      return { digits: pickDigits(rng, 3) };
    case 'pl5':
      return { digits: pickDigits(rng, 5) };
    default:
      return {};
  }
}

function asPick(gameId: GameId, numbers: DrawNumbers): GamePick {
  return {
    gameId,
    label: gameId,
    numbers,
    weights: DEFAULT_WEIGHTS,
    stats: { ...EMPTY_STATS, gameId },
  };
}

function stableIssueSeed(issue: string): number {
  let h = 0;
  for (let i = 0; i < issue.length; i++) h = (h * 31 + issue.charCodeAt(i)) >>> 0;
  return h;
}

function randomRateForPeriod(
  gameId: GameId,
  pickCount: number,
  actual: NormalizedDraw,
  randomTrials: number,
): number {
  let periodRandom = 0;
  const baseSeed = stableIssueSeed(actual.issue);
  for (let t = 0; t < randomTrials; t++) {
    const rng = createRng(baseSeed + t);
    const rnd = randomDrawNumbers(gameId, pickCount, rng);
    periodRandom += comparePickToDraw(asPick(gameId, rnd), actual).rate;
  }
  return periodRandom / randomTrials;
}

/**
 * Walk-forward core: for each issue after minHistory, predict → score → tune weights.
 * Training uses scoreWindow omitted (every step counts); backtest uses scoreWindow.
 */
export function runAdaptiveSimulation(
  chronological: NormalizedDraw[],
  gameId: GameId,
  options: SimulationOptions,
): SimulationResult | null {
  if (chronological.length <= options.minHistory) return null;

  const trainable = chronological.length - options.minHistory;
  const testCount = options.scoreWindow
    ? Math.min(options.scoreWindow, trainable)
    : trainable;
  if (testCount <= 0) return null;

  const testStartIdx = options.scoreWindow
    ? chronological.length - testCount
    : options.minHistory;

  const useAdaptive = options.adaptive !== false;
  const initialWeights = options.initialWeights
    ? { ...options.initialWeights }
    : { ...DEFAULT_WEIGHTS };
  let adaptiveWeights = { ...initialWeights };

  let adaptiveSum = 0;
  let fixedSum = 0;
  let randomSum = 0;
  let scored = 0;
  let firstScoredIssue = '';
  let lastScoredIssue = '';

  for (let idx = options.minHistory; idx < chronological.length; idx++) {
    const actual = chronological[idx];
    if (!actual) continue;
    const history = chronological.slice(0, idx).reverse();
    const tieSeed = `sim:${actual.issue}`;

    const fixedPick = recommendGame(gameId, history, {
      pickCount: options.pickCount,
      tieSeed,
      weights: DEFAULT_WEIGHTS,
    });

    const adaptivePick = useAdaptive
      ? recommendGame(gameId, history, {
          pickCount: options.pickCount,
          tieSeed,
          weights: adaptiveWeights,
        })
      : fixedPick;

    if (idx >= testStartIdx) {
      if (!firstScoredIssue) firstScoredIssue = actual.issue;
      lastScoredIssue = actual.issue;
      fixedSum += comparePickToDraw(fixedPick, actual).rate;
      adaptiveSum += comparePickToDraw(adaptivePick, actual).rate;
      randomSum += randomRateForPeriod(gameId, options.pickCount, actual, options.randomTrials);
      scored++;
    }

    if (useAdaptive) {
      adaptiveWeights = tuneWeightsFromDraw(
        adaptiveWeights,
        adaptivePick.numbers,
        actual.numbers,
        gameId,
        history,
      );
    }
  }

  if (!scored) return null;
  const adaptiveAvg = adaptiveSum / scored;
  const fixedAvg = fixedSum / scored;
  const randomAvg = randomSum / scored;

  return {
    gameId,
    periods: scored,
    warmupPeriods: testStartIdx - options.minHistory,
    adaptiveAvgHitRate: adaptiveAvg,
    fixedAvgHitRate: fixedAvg,
    randomAvgHitRate: randomAvg,
    adaptiveVsRandom: adaptiveAvg - randomAvg,
    adaptiveVsFixed: adaptiveAvg - fixedAvg,
    initialWeights,
    finalWeights: adaptiveWeights,
    firstScoredIssue,
    lastScoredIssue,
  };
}
