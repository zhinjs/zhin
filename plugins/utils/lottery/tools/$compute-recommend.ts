import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { handleComputeRecommend } from '../src/lottery-tool-handlers.js';
import { lotteryRuntimeToken } from '../src/runtime-state.js';

export default defineAgentTool<{ game: string }>({
  description: 'Compute lottery recommendation numbers via F/O/T stats engine',
  inputSchema: z.object({ game: z.string().min(1) }),
  async execute({ game }, context) {
    return handleComputeRecommend(context.use(lotteryRuntimeToken), game);
  },
});
