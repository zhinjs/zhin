import { messages as t } from "../../../../messages.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ user_id: string; content: string }>({
  description: '向指定企业微信用户发送文本消息（可发给任意用户，仅全局主人可用）',
  inputSchema: z.object({
    user_id: z.string().describe('用户 ID'),
    content: z.string().describe('消息内容'),
  }),
  adapter: 'wecom',
  tags: ['wecom'],
  // Messages any user of the organization, outside the current conversation: host-global (ADR 0056 §5).
  permissions: ['owner@global'],
  async execute({ user_id, content    }: { user_id: string; content: string }, context) {
    const endpoint = context.$client;
    const success = await endpoint.sendTextMessage(user_id, content);
    return { success, message: success ? t(context.locale, 'messageSent') : t(context.locale, 'sendFailed') };
  },
});

