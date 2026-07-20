import { defineCommand } from '@zhin.js/command';
import { parseGameId } from '../../src/games/registry.js';
import {
  formatTrainReport,
  trainAllGameWeights,
} from '../../src/evaluate/backtest.js';
import {
  getLotteryDb,
  resolveLotteryConfig,
  type LotteryConfig,
} from '../../src/command-helpers.js';
import { lotteryEnabledGames } from '../../src/config.js';
import { resolveLotteryRuntime } from '../../src/runtime-state.js';

export default defineCommand<LotteryConfig>({
  description: 'Full-history weight training',
  async execute({ params, config, owner, use }) {
    const db = resolveLotteryRuntime({ owner, use })?.db ?? getLotteryDb();
    if (!db) return '数据库未就绪';
    const cfg = resolveLotteryConfig(config);
    const gid = parseGameId(String(params.game ?? ''));
    const gameIds = gid ? [gid] : lotteryEnabledGames(cfg);
    const results = await trainAllGameWeights(db, gameIds, {
      pickCount: cfg.pickCount,
      minHistory: cfg.backtestMinHistory,
      historyLimit: cfg.historyLimit,
      randomTrials: cfg.backtestRandomTrials,
      holdoutWindow: cfg.backtestWindow,
      holdoutFallback: cfg.weightHoldoutFallback,
      persist: true,
    });
    return formatTrainReport(results);
  },
});
