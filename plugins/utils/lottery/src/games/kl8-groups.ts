import { DEFAULT_WEIGHTS, type DrawNumbers, type Kl8GroupStrategy, type Kl8PickGroup, type NormalizedDraw, type ScoreWeights } from '../types.js';

import { pickTopUnique, scorePool, type PoolScore } from '../stats/engine.js';

function poolDraws(draws: NormalizedDraw[], extract: (n: DrawNumbers) => number[]): number[][] {
  return draws.map((d) => extract(d.numbers)).filter((a) => a.length > 0);
}

export const KL8_STRATEGY_LABELS: Record<Kl8GroupStrategy, string> = {
  balanced: '均衡',
  hot: '热号',
  cold: '冷号',
  trend: '趋势',
};

const STRATEGY_PRESETS: Record<Exclude<Kl8GroupStrategy, 'balanced'>, ScoreWeights> = {
  hot: { freq: 0.55, omit: 0.2, trend: 0.25 },
  cold: { freq: 0.2, omit: 0.55, trend: 0.25 },
  trend: { freq: 0.25, omit: 0.25, trend: 0.5 },
};

export interface Kl8Config {
  pickCount: number;
  recommendGroups: number;
  groupStrategies: Kl8GroupStrategy[];
}

export interface Kl8ConfigInput {
  pickCount?: number;
  recommendGroups?: number;
  groupStrategies?: string[];
}

export function parseKl8GroupStrategy(raw: string): Kl8GroupStrategy {
  const s = raw.trim().toLowerCase();
  if (s === 'balanced' || s === 'hot' || s === 'cold' || s === 'trend') return s;
  return 'balanced';
}

export function resolveKl8Config(globalPickCount: number, raw?: Kl8ConfigInput): Kl8Config {
  const strategies = (raw?.groupStrategies?.length ? raw.groupStrategies : ['balanced', 'hot', 'cold']).map(
    parseKl8GroupStrategy,
  );
  const recommendGroups = Math.min(10, Math.max(1, raw?.recommendGroups ?? 3));
  const pickCount = Math.min(10, Math.max(1, raw?.pickCount ?? globalPickCount));
  return { pickCount, recommendGroups, groupStrategies: strategies };
}

export function weightsForKl8Strategy(strategy: Kl8GroupStrategy, base: ScoreWeights): ScoreWeights {
  if (strategy === 'balanced') return { ...base };
  return { ...STRATEGY_PRESETS[strategy] };
}

function strategiesForGroupCount(count: number, strategies: Kl8GroupStrategy[]): Kl8GroupStrategy[] {
  const pool = strategies.length ? strategies : (['balanced'] as Kl8GroupStrategy[]);
  return Array.from({ length: count }, (_, i) => pool[i % pool.length] ?? pool[0] ?? 'balanced');
}

export interface RecommendKl8GroupsResult {
  groups: Kl8PickGroup[];
  scores: PoolScore[];
}

/** Multi-strategy KL8 rows; groups may overlap — each picks top-N by its own weights. */
export function recommendKl8Groups(
  draws: NormalizedDraw[],
  options: {
    pickCount: number;
    recommendGroups: number;
    strategies: Kl8GroupStrategy[];
    tieSeed: string;
    baseWeights: ScoreWeights;
  },
): RecommendKl8GroupsResult {
  const rows = poolDraws(draws, (n) => n.main ?? []);
  const groupStrategies = strategiesForGroupCount(options.recommendGroups, options.strategies);
  const groups: Kl8PickGroup[] = [];
  let primaryScores: PoolScore[] = [];

  for (let i = 0; i < groupStrategies.length; i++) {
    const strategy = groupStrategies[i] ?? 'balanced';
    const weights = weightsForKl8Strategy(strategy, options.baseWeights);
    const scores = scorePool(rows, 1, 80, `${options.tieSeed}:${strategy}:${i}`, weights);
    if (i === 0) primaryScores = scores;
    const main = pickTopUnique(scores, options.pickCount);
    groups.push({
      index: i + 1,
      strategy,
      label: KL8_STRATEGY_LABELS[strategy],
      numbers: main,
      weights,
    });
  }

  return { groups, scores: primaryScores };
}

export { DEFAULT_WEIGHTS };
