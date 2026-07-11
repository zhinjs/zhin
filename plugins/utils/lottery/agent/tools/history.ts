import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { parseGameId } from '../../src/games/registry.js';
import { loadDraws } from '../../src/db.js';
import { getLotteryAgentDeps } from '../../src/lottery-agent-deps.js';

export default defineTool<{ game: string; count?: number }>({
  description: 'Query historical lottery draws',
  inputSchema: z.object({
    game: z.string().min(1),
    count: z.number().optional(),
  }),
  async execute({ game, count }) {
    const deps = getLotteryAgentDeps();
    const gid = parseGameId(game);
    if (!gid) return 'invalid game';
    const db = deps.getDb();
    if (!db) return 'db not ready';
    const lim = Math.min(30, count || 10);
    return JSON.stringify(await loadDraws(db, gid, lim));
  },
});
