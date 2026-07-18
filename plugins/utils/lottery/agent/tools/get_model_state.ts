import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { handleGetModelState } from '../../src/lottery-tool-handlers.js';

export default defineAgentTool<{ game?: string }>({
  description: 'Query model weights and historical hit rate per game',
  inputSchema: z.object({ game: z.string().optional() }),
  async execute({ game }) {
    return handleGetModelState(game);
  },
});
