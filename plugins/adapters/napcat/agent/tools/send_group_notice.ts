import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ group_id: number; content: string; image?: string }>({
  description: '发送群公告。',
  inputSchema: z.object({
    group_id: z.number().describe('群号'),
    content: z.string().describe('公告内容'),
    image: z.string().optional().describe('图片（URL 或 base64，可选）'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['群公告', 'notice', '公告', '发公告'],
  permissions: ['platform(napcat,scene_admin)'],
  scopes: ['group'],
  async execute({ group_id, content, image }: { group_id: number; content: string; image?: string }, context) {
    const endpoint = context.$client;
      await endpoint.sendGroupNotice(group_id, content, image);
      return { success: true };
  },
});
