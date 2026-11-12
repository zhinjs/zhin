import { currentChat } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<Record<string, never>>({
  description: '获取当前 Telegram 群组的管理员列表',
  inputSchema: z.object({}),
  adapter: 'telegram',
  scopes: ["group","channel"],
  tags: ['telegram'],
  async execute(_input, context) {
    const admins = await context.$client.getChatAdmins(currentChat(context));
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
