import { messages as t } from '../../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { parseGameId } from '../../../src/games/registry.js';
import { loadDraws } from '../../../src/db.js';
import { recommendGame, formatPickLine, formatPickStats } from '../../../src/recommend/game-pick.js';
import { loadAccuracySnapshot, loadGameWeights } from '../../../src/evaluate/tracker.js';
import {
  resolveLotteryConfig,
  type LotteryConfig,
} from '../../../src/command-helpers.js';
import { lotteryKl8 } from '../../../src/config.js';
import { lotteryRuntimeToken } from '../../../src/runtime-state.js';

export default defineCommand<LotteryConfig>({
  description: '查看单玩法统计',
  descriptionI18n: { en: 'Single-game stats snapshot' },
  params: { game: { type: 'string' } },
  async execute({ params, config, use, locale, formatCommand }) {
    const gid = parseGameId(String(params.game ?? ''));
    if (!gid) return t(locale, 'gameRequired');
    const { db } = use(lotteryRuntimeToken);
    const cfg = resolveLotteryConfig(config);
    const draws = await loadDraws(db, gid, cfg.historyLimit);
    if (!draws.length) {
      const command = formatCommand('lottery');
      return command ? t(locale, 'syncCommand', { command }) : t(locale, 'syncRequired');
    }
    const kl8 = lotteryKl8(cfg);
    const pick = recommendGame(gid, draws, {
      locale,
      pickCount: gid === 'kl8' ? kl8.pickCount : cfg.pickCount,
      tieSeed: 'stats',
      weights: await loadGameWeights(db, gid),
      accuracy: await loadAccuracySnapshot(db, gid),
      kl8: gid === 'kl8' ? kl8 : undefined,
    });
    return [formatPickLine(pick), formatPickStats(pick), t(locale, 'sample', { count: draws.length })].join('\n');
  },
});
