import { currentGroup, requireMessageInGroup } from '../../../../conversation.js';
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ message_id: number }>({
  description: '移除当前群中的精华消息。',
  inputSchema: z.object({
    message_id: z.number().describe('当前群中的消息 ID'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['取消精华', '移除精华', 'delete essence'],
  permissions: ['platform:admin', 'bot:admin'],
  scopes: ['group'],
  async execute({ message_id }, context) {
    const endpoint = context.$client;
    await requireMessageInGroup(context, currentGroup(context), message_id);
      await endpoint.deleteEssenceMsg(message_id);
      return { success: true };
  },
});
