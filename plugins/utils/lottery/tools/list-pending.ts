import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { handleListPending } from '../src/lottery-tool-handlers.js';
import { lotteryRuntimeToken } from '../src/runtime-state.js';

export default defineAgentTool<{ game?: string }>({
  description: 'List pending lottery predictions awaiting review',
  inputSchema: z.object({ game: z.string().min(1).optional() }),
  async execute({ game }, context) {
    return handleListPending(context.use(lotteryRuntimeToken), game);
  },
});
