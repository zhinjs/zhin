import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ message_id: number }>({
  description: '移除群精华消息。',
  inputSchema: z.object({
    message_id: z.number().describe('消息 ID'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['取消精华', '移除精华', 'delete essence'],
  permissions: ['platform(napcat,scene_admin)'],
  scopes: ['group'],
  async execute({ message_id }: { message_id: number }, context) {
    const endpoint = context.$client;
      await endpoint.deleteEssenceMsg(message_id);
      return { success: true };
  },
});
