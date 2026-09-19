import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ group_id: number; file: string }>({
  description: '设置群头像。file 为图片 URL 或 base64。',
  inputSchema: z.object({
    group_id: z.number().describe('群号'),
    file: z.string().describe('图片（URL 或 base64）'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['群头像', 'group portrait', '设置群头像'],
  permissions: ['platform(napcat,scene_admin)'],
  scopes: ['group'],
  async execute({ group_id, file }: { group_id: number; file: string }, context) {
    const endpoint = context.$client;
      await endpoint.setGroupPortrait(group_id, file);
      return { success: true };
  },
});
