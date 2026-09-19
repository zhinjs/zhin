import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ user_id: number }>({
  description: '获取用户在线状态。',
  inputSchema: z.object({
    user_id: z.number().describe('目标 QQ 号'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['在线状态', '用户状态', 'online status'],
  async execute({ user_id }: { user_id: number }, context) {
    const endpoint = context.$client;
      return endpoint.ncGetUserStatus(user_id);
  },
});
