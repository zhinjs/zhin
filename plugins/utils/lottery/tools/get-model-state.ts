import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { handleGetModelState } from '../src/lottery-tool-handlers.js';
import { lotteryRuntimeToken } from '../src/runtime-state.js';

export default defineAgentTool<{ game?: string }>({
  description: 'Query model weights and historical hit rate per game',
  inputSchema: z.object({ game: z.string().min(1).optional() }),
  async execute({ game }, context) {
    return handleGetModelState(context.use(lotteryRuntimeToken), game);
  },
});
