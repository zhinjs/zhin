export type GameId = 'kl8' | 'ssq' | 'dlt' | 'fc3d' | 'pl3' | 'pl5';

export type LotterySource = 'fucai' | 'ticai';

export interface DrawNumbers {
  main?: number[];
  red?: number[];
  blue?: number[];
  front?: number[];
  back?: number[];
  digits?: number[];
}

export interface NormalizedDraw {
  gameId: GameId;
  issue: string;
  drawTime: string;
  numbers: DrawNumbers;
  source: LotterySource;
}

/** 打分权重：频率 / 遗漏 / 近期趋势 */
export interface ScoreWeights {
  freq: number;
  omit: number;
  trend: number;
}

export interface ProMetrics {
  oddEven: string;
  bigSmall: string;
  sum: number;
  span: number;
  zones?: string;
  digitPos?: string;
  recentHot: string;
  modelWeights: string;
}

export interface AccuracySnapshot {
  evalCount: number;
  avgHitRate: number;
  recent5: string;
}

export interface StatsSnapshot {
  gameId: GameId;
  sampleSize: number;
  hot: string[];
  cold: string[];
  detail: string;
  pro?: ProMetrics;
  accuracy?: AccuracySnapshot;
}

export interface GamePick {
  gameId: GameId;
  label: string;
  numbers: DrawNumbers;
  stats: StatsSnapshot;
  weights: ScoreWeights;
  /** KL8 multi-strategy rows (primary numbers still in numbers.main) */
  kl8Groups?: Kl8PickGroup[];
}

export type Kl8GroupStrategy = 'balanced' | 'hot' | 'cold' | 'trend';

export interface Kl8PickGroup {
  index: number;
  strategy: Kl8GroupStrategy;
  label: string;
  numbers: number[];
  weights: ScoreWeights;
}

export interface HitSummary {
  total: number;
  hits: number;
  rate: number;
  detail: string;
}

export interface DailyReport {
  date: string;
  picks: GamePick[];
  disclaimer: string;
  accuracyOverview?: string;
  backtestOverview?: string;
  /** games that used DEFAULT due to holdout guard */
  weightFallbackGames?: GameId[];
  /** Agent 生成的完整正文（优先展示） */
  body?: string;
}

export const DISCLAIMER =
  '免责声明：本推荐由历史数据统计生成，仅供参考，不构成投注建议，不保证中奖。请理性购彩。';

export const DEFAULT_WEIGHTS: ScoreWeights = { freq: 0.4, omit: 0.35, trend: 0.25 };
