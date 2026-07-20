import { defineCommand } from '@zhin.js/command';
import { parseGameId } from '../../src/games/registry.js';
import { loadDraws } from '../../src/db.js';
import { recommendGame, formatPickLine, formatPickStats } from '../../src/recommend/game-pick.js';
import { loadAccuracySnapshot, loadGameWeights } from '../../src/evaluate/tracker.js';
import {
  getLotteryDb,
  resolveLotteryConfig,
  type LotteryConfig,
} from '../../src/command-helpers.js';
import { lotteryKl8 } from '../../src/config.js';

export default defineCommand<LotteryConfig>({
  description: 'Single-game stats snapshot',
  async execute({ params, config }) {
    const gid = parseGameId(String(params.game ?? ''));
    if (!gid) return '请指定玩法';
    const db = getLotteryDb();
    if (!db) return '数据库未就绪';
    const cfg = resolveLotteryConfig(config);
    const draws = await loadDraws(db, gid, cfg.historyLimit);
    if (!draws.length) return '暂无数据，请先 lottery';
    const kl8 = lotteryKl8(cfg);
    const pick = recommendGame(gid, draws, {
      pickCount: gid === 'kl8' ? kl8.pickCount : cfg.pickCount,
      tieSeed: 'stats',
      weights: await loadGameWeights(db, gid),
      accuracy: await loadAccuracySnapshot(db, gid),
      kl8: gid === 'kl8' ? kl8 : undefined,
    });
    return [formatPickLine(pick), formatPickStats(pick), `样本 ${draws.length} 期`].join('\n');
  },
});
