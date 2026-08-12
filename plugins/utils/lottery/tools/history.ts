import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { parseGameId } from '../src/games/registry.js';
import { loadDraws } from '../src/db.js';
import { lotteryRuntimeToken } from '../src/runtime-state.js';

export default defineAgentTool<{ game: string; count?: number }>({
  description: 'Query historical lottery draws',
  inputSchema: z.object({ game: z.string().min(1), count: z.number().int().positive().optional() }),
  async execute({ game, count }, context) {
    const runtime = context.use(lotteryRuntimeToken);
    const gid = parseGameId(game);
    if (!gid) return 'invalid game';
    const lim = Math.min(30, count || 10);
    return JSON.stringify(await loadDraws(runtime.db, gid, lim));
  },
});
