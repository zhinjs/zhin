import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ userId: string }>({
  description: 'Get LINE user profile by userId',
  adapter: 'line',
  inputSchema: z.object({
    userId: z.string().min(1),
  }),
  async execute({ userId }, context) {
    if (!userId.startsWith('U')) {
      throw new Error(`Invalid userId "${userId}": must start with U`);
    }
    return context.$client.getProfile(userId);
  },
});
