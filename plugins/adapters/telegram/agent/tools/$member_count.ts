import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ chat_id: string }>({
  description: '获取 Telegram 群组成员数量',
  inputSchema: z.object({
    chat_id: z.string().describe('聊天 ID'),
  }),
  adapter: 'telegram',
  tags: ['telegram'],
  async execute({ chat_id  }: { chat_id: string }, context) {
    const endpoint = context.$client;
    const count = await endpoint.getChatMemberCount(Number(chat_id));
    return { count, message: `群组共有 ${count} 名成员` };
  },
});
