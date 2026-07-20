import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { handleStatsSnapshot } from '../../src/lottery-tool-handlers.js';

export default defineAgentTool<{ game: string }>({
  description: 'Get stats snapshot for a lottery game',
  inputSchema: z.object({ game: z.string().min(1) }),
  async execute({ game }) {
    return handleStatsSnapshot(game);
  },
});
