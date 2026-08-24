import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
export default defineAgentTool<{ user_id: string }>({
  description: '获取企业微信用户信息',
  inputSchema: z.object({
    user_id: z.string().describe('用户 ID'),
  }),
  adapter: 'wecom',
  tags: ['wecom'],
  async execute({ user_id    }: { user_id: string }, context) {
    const endpoint = context.$client;
    return await endpoint.getUserInfo(user_id);
  },
});

