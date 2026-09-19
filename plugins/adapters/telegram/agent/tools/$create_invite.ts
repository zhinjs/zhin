import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';

export default defineAgentTool<{ chat_id: string }>({
  description: '创建 Telegram 群组邀请链接',
  inputSchema: z.object({
    chat_id: z.string().describe('聊天 ID'),
  }),
  adapter: 'telegram',
  tags: ['telegram'],
  permissions: [platformPermit('chat_administrator')],
  async execute({ chat_id  }: { chat_id: string }, context) {
    const endpoint = context.$client;
    const link = await endpoint.createInviteLink(Number(chat_id));
    return { invite_link: link, message: `邀请链接: ${link}` };
  },
});
