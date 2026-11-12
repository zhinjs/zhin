import { messages as t } from "../../../../messages.js";
import { currentChat } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ message_id: string }>({
  description: '置顶当前 Telegram 群组中的消息',
  inputSchema: z.object({
    message_id: z.string().describe('消息 ID'),
  }),
  adapter: 'telegram',
  scopes: ["group","channel"],
  tags: ['telegram'],
  permissions: ['platform-permission:pin_messages', 'bot-permission:pin_messages'],
  async execute({ message_id }, context) {
    const endpoint = context.$client;
    const success = await endpoint.pinMessage(currentChat(context), Number(message_id));
    return { success, message: success ? t(context.locale, 'pinDone') : t(context.locale, 'operationFailed') };
  },
});
