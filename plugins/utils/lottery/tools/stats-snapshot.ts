import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { handleStatsSnapshot } from '../src/lottery-tool-handlers.js';
import { lotteryRuntimeToken } from '../src/runtime-state.js';

export default defineAgentTool<{ game: string }>({
  description: 'Get stats snapshot for a lottery game',
  inputSchema: z.object({ game: z.string().min(1) }),
  async execute({ game }, context) {
    return handleStatsSnapshot(context.use(lotteryRuntimeToken), game);
  },
});
