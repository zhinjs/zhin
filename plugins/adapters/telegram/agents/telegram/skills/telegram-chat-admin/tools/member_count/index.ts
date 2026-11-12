import { messages as t } from "../../../../messages.js";
import { currentChat } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<Record<string, never>>({
  description: '获取当前 Telegram 群组的成员数量',
  inputSchema: z.object({}),
  adapter: 'telegram',
  scopes: ["group","channel"],
  tags: ['telegram'],
  async execute(_input, context) {
    const count = await context.$client.getChatMemberCount(currentChat(context));
    return { count, message: t(context.locale, 'memberCount', { p0: count }) };
  },
});
