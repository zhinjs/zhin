import { defineCommand } from '@zhin.js/command';
import { parseGameId } from '../../src/games/registry.js';
import { loadDraws } from '../../src/db.js';
import { getLotteryDb, type LotteryConfig } from '../../src/command-helpers.js';

export default defineCommand<LotteryConfig>({
  description: 'List historical draw results',
  async execute({ params, args }) {
    const gid = parseGameId(String(params.game ?? ''));
    if (!gid) return '请指定玩法';
    const db = getLotteryDb();
    if (!db) return '数据库未就绪';
    // count 原来是第二动态段，约定式命令只支持单动态文件参数，改从 args 取
    const count = Math.min(50, Math.max(1, Number(args[0]) || 10));
    const draws = await loadDraws(db, gid, count);
    if (!draws.length) return '暂无数据';
    return draws.map((d) => `${d.issue} ${d.drawTime} ${JSON.stringify(d.numbers)}`).join('\n');
  },
});
