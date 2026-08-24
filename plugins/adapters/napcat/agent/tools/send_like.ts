import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ user_id: number; times?: number }>({
  description: '给好友点赞（每人每天最多 10 次）。',
  inputSchema: z.object({
    user_id: z.number().describe('目标 QQ 号'),
    times: z.number().optional().describe('点赞次数（1-10）'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['点赞', 'like', '赞', '好友赞'],
  async execute({ user_id, times }: { user_id: number; times?: number }, context) {
    const endpoint = context.$client;
      await endpoint.sendLike(user_id, times || 1);
      return { success: true, message: `已给 ${user_id} 点赞 ${times || 1} 次` };
  },
});
