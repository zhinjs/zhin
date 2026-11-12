import { currentGroup } from '../../../../conversation.js';
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ content: string; image?: string }>({
  description: '在当前群发送群公告。',
  inputSchema: z.object({
    content: z.string().describe('公告内容'),
    image: z.string().optional().describe('图片（URL 或 base64，可选）'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['群公告', 'notice', '公告', '发公告'],
  permissions: ['platform:admin', 'bot:admin'],
  scopes: ['group'],
  async execute({ content, image }, context) {
    const endpoint = context.$client;
      await endpoint.sendGroupNotice(currentGroup(context), content, image);
      return { success: true };
  },
});
