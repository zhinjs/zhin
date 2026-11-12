import { messages as t } from "../../../../messages.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ chat_id: string }>({
  description: '创建 Telegram 群组邀请链接',
  inputSchema: z.object({
    chat_id: z.string().describe('聊天 ID'),
  }),
  adapter: 'telegram',
  scopes: ["group","channel"],
  tags: ['telegram'],
  permissions: ['platform-permission:chat_administrator'],
  async execute({ chat_id  }: { chat_id: string }, context) {
    const endpoint = context.$client;
    const link = await endpoint.createInviteLink(Number(chat_id));
    return { invite_link: link, message: t(context.locale, 'inviteLink', { p0: link }) };
  },
});
