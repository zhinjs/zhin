import { messages as t } from "../../../../messages.js";
import { currentChat } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ name?: string; description?: string }>({
  description: '更新当前飞书群聊信息（群名、描述）',
  inputSchema: z.object({
    name: z.string().optional().describe('新群名（可选）'),
    description: z.string().optional().describe('新描述（可选）'),
  }),
  adapter: 'lark',
  scopes: ["group"],
  tags: ['lark'],
  permissions: ['platform:admin', 'bot:admin'],
  async execute({ name, description }, context) {
    const endpoint = context.$client;
    const success = await endpoint.updateChatInfo(currentChat(context), { name, description });
    return { success, message: success ? t(context.locale, 'chatInfoUpdated') : t(context.locale, 'updateFailed') };
  },
});
