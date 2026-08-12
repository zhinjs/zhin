import { defineCommand } from '@zhin.js/command';
import { parseGameId } from '../../src/games/registry.js';
import {
  formatTrainReport,
  trainAllGameWeights,
} from '../../src/evaluate/backtest.js';
import {
  resolveLotteryConfig,
  type LotteryConfig,
} from '../../src/command-helpers.js';
import { lotteryEnabledGames } from '../../src/config.js';
import { lotteryRuntimeToken } from '../../src/runtime-state.js';

export default defineCommand<LotteryConfig>({
  description: 'Full-history weight training',
  params: { game: { type: 'string', default: '' } },
  async execute({ params, config, use }) {
    const { db } = use(lotteryRuntimeToken);
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
