import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { platformPermission } from '@zhin.js/permission';

export default defineAgentTool<{ chat_id: string }>({
  description: '创建 Telegram 群组邀请链接',
  inputSchema: z.object({
    chat_id: z.string().describe('聊天 ID'),
  }),
  adapter: 'telegram',
  tags: ['telegram'],
  permissions: [platformPermission('telegram', 'chat_administrator')],
  async execute({ chat_id  }: { chat_id: string }, context) {
    const endpoint = context.$client;
    const link = await endpoint.createInviteLink(Number(chat_id));
    return { invite_link: link, message: `邀请链接: ${link}` };
  },
});
