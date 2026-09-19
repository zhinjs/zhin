import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { parseGameId } from '../src/games/registry.js';
import { lotteryRuntimeToken } from '../src/runtime-state.js';
import { runDataSync } from '../src/sync/run-sync.js';

export default defineAgentTool<{ game?: string }>({
  description: 'Sync official lottery draws into DB',
  inputSchema: z.object({ game: z.string().min(1).optional() }),
  async execute({ game }, context) {
    const runtime = context.use(lotteryRuntimeToken);
    const gid = parseGameId(game ?? '');
    const result = await runDataSync(
      () => runtime.db,
      () => [...runtime.enabledGames],
      runtime.config.historyLimit,
      gid ?? undefined,
    );
    return JSON.stringify({ result });
  },
});
