import { defineCommand } from '@zhin.js/command';
import { parseGameId } from '../../src/games/registry.js';
import {
  formatBacktestSection,
  runBacktestForGames,
} from '../../src/evaluate/backtest.js';
import {
  getLotteryDb,
  resolveLotteryConfig,
  type LotteryConfig,
} from '../../src/command-helpers.js';
import { lotteryEnabledGames } from '../../src/config.js';

export default defineCommand<LotteryConfig>({
  description: 'Walk-forward backtest vs random baseline',
  async execute({ params, config }) {
    const db = getLotteryDb();
    if (!db) return '数据库未就绪';
    const cfg = resolveLotteryConfig(config);
    const gid = parseGameId(String(params.game ?? ''));
    const gameIds = gid ? [gid] : lotteryEnabledGames(cfg);
    const summaries = await runBacktestForGames(db, gameIds, {
      pickCount: cfg.pickCount,
      window: cfg.backtestWindow,
      randomTrials: cfg.backtestRandomTrials,
      minHistory: cfg.backtestMinHistory,
      historyLimit: cfg.historyLimit,
      adaptive: cfg.backtestAdaptive,
    });
    const text = formatBacktestSection(summaries);
    return text || '历史数据不足，请先执行 lottery 同步开奖';
  },
});
