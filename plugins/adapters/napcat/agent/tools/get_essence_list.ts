import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ group_id: number }>({
  description: '获取群精华消息列表。',
  inputSchema: z.object({
    group_id: z.number().describe('群号'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['精华列表', 'essence list'],
  scopes: ['group'],
  async execute({ group_id }: { group_id: number }, context) {
    const endpoint = context.$client;
      return endpoint.getEssenceMsgList(group_id);
  },
});
