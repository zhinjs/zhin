import { currentGroup } from '../../../../conversation.js';
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ notice_id: string }>({
  description: '删除当前群的群公告。',
  inputSchema: z.object({
    notice_id: z.string().describe('公告 ID'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['删除公告', 'delete notice'],
  permissions: ['platform:admin', 'bot:admin'],
  scopes: ['group'],
  async execute({ notice_id }, context) {
    const endpoint = context.$client;
      await endpoint.deleteGroupNotice(currentGroup(context), notice_id);
      return { success: true };
  },
});
