import { messages as t } from "../../../../messages.js";
import { currentChat } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<Record<string, never>>({
  description: '为当前 Telegram 群组创建邀请链接',
  inputSchema: z.object({}),
  adapter: 'telegram',
  scopes: ["group","channel"],
  tags: ['telegram'],
  permissions: ['platform-permission:invite_users', 'bot-permission:invite_users'],
  async execute(_args, context) {
    const endpoint = context.$client;
    const link = await endpoint.createInviteLink(currentChat(context));
    return { invite_link: link, message: t(context.locale, 'inviteLink', { p0: link }) };
  },
});
