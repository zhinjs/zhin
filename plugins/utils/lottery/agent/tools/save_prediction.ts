import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { handleSavePrediction } from '../../src/lottery-tool-handlers.js';

export default defineAgentTool<{ game: string; numbers_json: string }>({
  description: 'Save a pending lottery prediction',
  inputSchema: z.object({
    game: z.string().min(1),
    numbers_json: z.string().min(1),
  }),
  async execute({ game, numbers_json }) {
    return handleSavePrediction(game, numbers_json);
  },
});
