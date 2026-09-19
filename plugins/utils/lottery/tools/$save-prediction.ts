import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { handleSavePrediction } from '../src/lottery-tool-handlers.js';
import { lotteryRuntimeToken } from '../src/runtime-state.js';

export default defineAgentTool<{ game: string; numbers_json: string }>({
  description: 'Save a pending lottery prediction',
  inputSchema: z.object({ game: z.string().min(1), numbers_json: z.string().min(1) }),
  async execute({ game, numbers_json }, context) {
    return handleSavePrediction(context.use(lotteryRuntimeToken), game, numbers_json);
  },
});
