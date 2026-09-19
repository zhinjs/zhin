import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ chat_id: string; description: string }>({
  description: '设置 Telegram 群组描述',
  inputSchema: z.object({
    chat_id: z.string().describe('聊天 ID'),
    description: z.string().describe('群描述文字'),
  }),
  adapter: 'telegram',
  tags: ['telegram'],
  async execute({ chat_id, description  }: { chat_id: string; description: string }, context) {
    const endpoint = context.$client;
    const success = await endpoint.setChatDescription(Number(chat_id), description);
    return { success, message: success ? '群描述已更新' : '操作失败' };
  },
});
