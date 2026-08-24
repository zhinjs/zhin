import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ chat_id: string; message_id: string; reaction: string }>({
  description: '对 Telegram 消息添加表情反应',
  inputSchema: z.object({
    chat_id: z.string().describe('聊天 ID'),
    message_id: z.string().describe('消息 ID'),
    reaction: z.string().describe('反应表情（如 👍、❤️、🔥）'),
  }),
  adapter: 'telegram',
  tags: ['telegram'],
  async execute({ chat_id, message_id, reaction  }: { chat_id: string; message_id: string; reaction: string }, context) {
    const endpoint = context.$client;
    const success = await endpoint.setMessageReaction(Number(chat_id), Number(message_id), reaction);
    return { success, message: success ? `已添加反应 ${reaction}` : '操作失败' };
  },
});
