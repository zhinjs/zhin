import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ group_id: number; notice_id: string }>({
  description: '删除群公告。',
  inputSchema: z.object({
    group_id: z.number().describe('群号'),
    notice_id: z.string().describe('公告 ID'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['删除公告', 'delete notice'],
  permissions: ['platform(napcat,scene_admin)'],
  scopes: ['group'],
  async execute({ group_id, notice_id }: { group_id: number; notice_id: string }, context) {
    const endpoint = context.$client;
      await endpoint.deleteGroupNotice(group_id, notice_id);
      return { success: true };
  },
});
