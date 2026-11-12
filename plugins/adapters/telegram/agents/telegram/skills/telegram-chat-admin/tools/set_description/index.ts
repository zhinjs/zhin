import { messages as t } from "../../../../messages.js";
import { currentChat } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ description: string }>({
  description: '设置当前 Telegram 群组描述',
  inputSchema: z.object({
    description: z.string().describe('群描述文字'),
  }),
  adapter: 'telegram',
  scopes: ["group","channel"],
  permissions: ['platform-permission:change_info', 'bot-permission:change_info'],
  tags: ['telegram'],
  async execute({ description }, context) {
    const endpoint = context.$client;
    const success = await endpoint.setChatDescription(currentChat(context), description);
    return { success, message: success ? t(context.locale, 'descriptionUpdated') : t(context.locale, 'operationFailed') };
  },
});
