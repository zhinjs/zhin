import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ chat_id: string }>({
  description: '获取 Telegram 群组管理员列表',
  inputSchema: z.object({
    chat_id: z.string().describe('聊天 ID'),
  }),
  adapter: 'telegram',
  tags: ['telegram'],
  async execute({ chat_id  }: { chat_id: string }, context) {
    const endpoint = context.$client;
    const admins = await endpoint.getChatAdmins(Number(chat_id));
    return {
      admins: admins.map((a: { user: { id: number; username?: string; first_name?: string }; status: string }) => ({
        user_id: a.user.id,
        username: a.user.username,
        first_name: a.user.first_name,
        status: a.status,
      })),
      count: admins.length,
    };
  },
});
