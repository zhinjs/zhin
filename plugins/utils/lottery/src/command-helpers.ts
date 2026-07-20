import {
  lotteryEnabledGames,
  lotteryKl8,
  resolveLotteryConfig,
  type LotteryConfig,
} from './config.js';
import { getLotteryDb } from './db-store.js';
import type { LotteryDb } from './db.js';
import { formatPipelineReply, runLotteryPipeline, type PipelineDeps } from './pipeline.js';

export function buildPipelineDeps(
  raw: Partial<LotteryConfig> | undefined,
  db: LotteryDb | null = getLotteryDb(),
): PipelineDeps {
  const config = resolveLotteryConfig(raw);
  return {
    getDb: () => db,
    enabledGames: () => lotteryEnabledGames(config),
    historyLimit: config.historyLimit,
    pickCount: config.pickCount,
    kl8: lotteryKl8(config),
    backtest: {
      enabled: config.backtestEnabled,
      window: config.backtestWindow,
      randomTrials: config.backtestRandomTrials,
      minHistory: config.backtestMinHistory,
      adaptive: config.backtestAdaptive,
    },
    weightPersist: config.weightPersistEnabled,
    weightHoldoutFallback: config.weightHoldoutFallback,
  };
}

export { formatPipelineReply, runLotteryPipeline, resolveLotteryConfig, getLotteryDb };
export type { LotteryConfig };
