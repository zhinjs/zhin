import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ group_id: number }>({
  description: '获取群组额外详细信息。',
  inputSchema: z.object({
    group_id: z.number().describe('群号'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['群详情', '群额外信息', 'group info ex'],
  scopes: ['group'],
  async execute({ group_id }: { group_id: number }, context) {
    const endpoint = context.$client;
      return endpoint.getGroupInfoEx(group_id);
  },
});
