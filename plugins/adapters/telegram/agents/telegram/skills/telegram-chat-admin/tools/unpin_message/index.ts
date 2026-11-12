import { messages as t } from "../../../../messages.js";
import { currentChat } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ message_id?: string }>({
  description: '取消置顶当前 Telegram 群组中的消息',
  inputSchema: z.object({
    message_id: z.string().optional().describe('消息 ID（可选，不提供则取消所有置顶）'),
  }),
  adapter: 'telegram',
  scopes: ["group","channel"],
  tags: ['telegram'],
  permissions: ['platform-permission:pin_messages', 'bot-permission:pin_messages'],
  async execute({ message_id }, context) {
    const endpoint = context.$client;
    const success = await endpoint.unpinMessage(currentChat(context), message_id ? Number(message_id) : undefined);
    return { success, message: success ? t(context.locale, 'messageUnpinned') : t(context.locale, 'operationFailed') };
  },
});
