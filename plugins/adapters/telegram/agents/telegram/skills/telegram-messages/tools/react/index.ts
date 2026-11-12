import { messages as t } from "../../../../messages.js";
import { currentChat } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ message_id: string; reaction: string }>({
  description: '对当前 Telegram 会话中的消息添加表情反应',
  inputSchema: z.object({
    message_id: z.string().describe('当前会话中的消息 ID'),
    reaction: z.string().describe('反应表情（如 👍、❤️、🔥）'),
  }),
  adapter: 'telegram',
  tags: ['telegram'],
  async execute({ message_id, reaction }, context) {
    const success = await context.$client.setMessageReaction(currentChat(context, { allowPrivate: true }), Number(message_id), reaction);
    return { success, message: success ? t(context.locale, 'reactionAdded', { p0: reaction }) : t(context.locale, 'operationFailed') };
  },
});
