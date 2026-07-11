import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { handleComputeRecommend } from '../../src/lottery-tool-handlers.js';

export default defineTool<{ game: string }>({
  description: 'Compute lottery recommendation numbers via F/O/T stats engine',
  inputSchema: z.object({ game: z.string().min(1) }),
  async execute({ game }) {
    return handleComputeRecommend(game);
  },
});
