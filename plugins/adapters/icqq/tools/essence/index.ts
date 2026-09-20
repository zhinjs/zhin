import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ message_id: string; action: 'add' | 'remove' }>({
  description: '设置或移除 QQ 群精华消息',
  inputSchema: z.object({
    message_id: z.string().describe('消息 ID'),
    action: z.enum(['add', 'remove']).describe('add=设为精华, remove=移除精华'),
  }),
  adapter: 'icqq',
  approval: 'always',
  async execute({ message_id, action }, context) {
    const client = context.$client;
    if (action === 'add') {
      await client.setEssenceMessage(message_id);
    } else {
      await client.removeEssenceMessage(message_id);
    }
    return { success: true, message: action === 'add' ? '已设为精华' : '已移除精华' };
  },
});
