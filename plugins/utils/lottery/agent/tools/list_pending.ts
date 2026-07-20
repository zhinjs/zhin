import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { handleListPending } from '../../src/lottery-tool-handlers.js';

export default defineAgentTool<{ game?: string }>({
  description: 'List pending lottery predictions awaiting review',
  inputSchema: z.object({ game: z.string().optional() }),
  async execute({ game }) {
    return handleListPending(game);
  },
});
