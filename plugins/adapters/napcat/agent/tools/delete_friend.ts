import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ user_id: number }>({
  description: '删除好友。',
  inputSchema: z.object({
    user_id: z.number().describe('好友 QQ 号'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['删除好友', 'delete friend', '删好友'],
  permissions: ['platform(napcat,scene_admin)'],
  async execute({ user_id }: { user_id: number }, context) {
    const endpoint = context.$client;
      await endpoint.deleteFriend(user_id);
      return { success: true };
  },
});
