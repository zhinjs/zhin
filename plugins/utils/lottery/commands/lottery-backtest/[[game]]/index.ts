import { messages as t } from '../../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { parseGameId } from '../../../src/games/registry.js';
import {
  formatBacktestSection,
  runBacktestForGames,
} from '../../../src/evaluate/backtest.js';
import {
  resolveLotteryConfig,
  type LotteryConfig,
} from '../../../src/command-helpers.js';
import { lotteryEnabledGames } from '../../../src/config.js';
import { lotteryRuntimeToken } from '../../../src/runtime-state.js';

export default defineCommand<LotteryConfig>({
  description: '滚动回测与随机基线比较',
  descriptionI18n: { en: 'Walk-forward backtest vs random baseline' },
  params: { game: { type: 'string', default: '' } },
  async execute({ params, config, use, locale, formatCommand }) {
    const { db } = use(lotteryRuntimeToken);
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
    const text = formatBacktestSection(summaries, locale);
    if (text) return text;
    const command = formatCommand('lottery');
    return command ? t(locale, 'syncCommand', { command }) : t(locale, 'syncRequired');
  },
});
