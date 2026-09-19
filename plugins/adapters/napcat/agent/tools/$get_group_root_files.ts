import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ group_id: number }>({
  description: '获取群根目录文件列表。',
  inputSchema: z.object({
    group_id: z.number().describe('群号'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['群文件列表', 'group files'],
  scopes: ['group'],
  async execute({ group_id }: { group_id: number }, context) {
    const endpoint = context.$client;
      return endpoint.getGroupRootFiles(group_id);
  },
});
