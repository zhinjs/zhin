import { messages as t } from '../../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { parseGameId } from '../../../src/games/registry.js';
import { loadDraws } from '../../../src/db.js';
import type { LotteryConfig } from '../../../src/command-helpers.js';
import { lotteryRuntimeToken } from '../../../src/runtime-state.js';

export default defineCommand<LotteryConfig>({
  description: '查询历史开奖结果',
  descriptionI18n: { en: 'List historical draw results' },
  params: { game: { type: 'string' } },
  async execute({ params, args, use, locale }) {
    const gid = parseGameId(String(params.game ?? ''));
    if (!gid) return t(locale, 'gameRequired');
    const { db } = use(lotteryRuntimeToken);
    // count 原来是第二动态段，约定式命令只支持单动态文件参数，改从 args 取
    const count = Math.min(50, Math.max(1, Number(args[0]) || 10));
    const draws = await loadDraws(db, gid, count);
    if (!draws.length) return t(locale, 'noData');
    return draws.map((d) => `${d.issue} ${d.drawTime} ${JSON.stringify(d.numbers)}`).join('\n');
  },
});
