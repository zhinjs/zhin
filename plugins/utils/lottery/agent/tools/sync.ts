import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { parseGameId } from '../../src/games/registry.js';
import { getLotteryAgentDeps } from '../../src/lottery-agent-deps.js';
import { runDataSync } from '../../src/sync/run-sync.js';

export default defineAgentTool<{ game?: string }>({
  description: 'Sync official lottery draws into DB',
  inputSchema: z.object({ game: z.string().optional() }),
  async execute({ game }) {
    const deps = getLotteryAgentDeps();
    const db = deps.getDb();
    if (!db) return 'db not ready';
    const gid = parseGameId(game ?? '');
    const result = await runDataSync(deps.getDb, deps.enabledGames, deps.getConfig().historyLimit, gid ?? undefined);
    return JSON.stringify({ result });
  },
});
