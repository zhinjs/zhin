import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ message_id: number }>({
  description: '标记消息为已读。',
  inputSchema: z.object({
    message_id: z.number().describe('消息 ID'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['已读', 'mark read', '标记已读'],
  async execute({ message_id }: { message_id: number }, context) {
    const endpoint = context.$client;
      await endpoint.markMsgAsRead(message_id);
      return { success: true };
  },
});
