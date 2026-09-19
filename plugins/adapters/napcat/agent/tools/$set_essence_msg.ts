import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ message_id: number }>({
  description: '设置群精华消息。',
  inputSchema: z.object({
    message_id: z.number().describe('消息 ID'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['精华', 'essence', '设精', '加精'],
  permissions: ['platform(napcat,scene_admin)'],
  scopes: ['group'],
  async execute({ message_id }: { message_id: number }, context) {
    const endpoint = context.$client;
      await endpoint.setEssenceMsg(message_id);
      return { success: true };
  },
});
