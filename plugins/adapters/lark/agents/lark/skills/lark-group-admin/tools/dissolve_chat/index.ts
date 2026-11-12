import { messages as t } from "../../../../messages.js";
import { currentChat } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<Record<string, never>>({
  description: '解散当前飞书群聊（需要群主权限）',
  inputSchema: z.object({}),
  adapter: 'lark',
  scopes: ["group"],
  permissions: ['platform:owner', 'bot:owner'],
  tags: ['lark'],
  async execute(_args, context) {
    const endpoint = context.$client;
    const success = await endpoint.dissolveChat(currentChat(context));
    return { success, message: success ? t(context.locale, 'chatDissolved') : t(context.locale, 'dissolveFailed') };
  },
});

