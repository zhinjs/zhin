import { currentGroup, requireMessageInGroup } from '../../../../conversation.js';
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ message_id: number }>({
  description: '把当前群中的消息设为精华。',
  inputSchema: z.object({
    message_id: z.number().describe('当前群中的消息 ID'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['精华', 'essence', '设精', '加精'],
  permissions: ['platform:admin', 'bot:admin'],
  scopes: ['group'],
  async execute({ message_id }, context) {
    const endpoint = context.$client;
    await requireMessageInGroup(context, currentGroup(context), message_id);
      await endpoint.setEssenceMsg(message_id);
      return { success: true };
  },
});
