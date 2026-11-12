import { messages as t } from "../../../../messages.js";
import { currentChat } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ user_ids: string }>({
  description: '移除当前飞书群的管理员',
  inputSchema: z.object({
    user_ids: z.string().describe('用户 open_id 列表，逗号分隔'),
  }),
  adapter: 'lark',
  scopes: ["group"],
  tags: ['lark'],
  permissions: ['platform:owner', 'bot:owner'],
  async execute({ user_ids }, context) {
    const endpoint = context.$client;
    const success = await endpoint.removeChatManagers(currentChat(context), user_ids.split(','));
    return { success, message: success ? t(context.locale, 'managersRemoved') : t(context.locale, 'removeFailed') };
  },
});
