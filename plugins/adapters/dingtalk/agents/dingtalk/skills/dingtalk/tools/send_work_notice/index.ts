import { messages as t } from "../../../../messages.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ user_ids: string; content: string }>({
  description: '向指定用户发送钉钉工作通知（可发给任意用户，仅全局主人可用）',
  inputSchema: z.object({
    user_ids: z.string().describe('用户 ID 列表，逗号分隔'),
    content: z.string().describe('通知内容'),
  }),
  adapter: 'dingtalk',
  tags: ['dingtalk'],
  // Messages any user of the organization, outside the current conversation: host-global (ADR 0056 §5).
  permissions: ['owner@global'],
  async execute({ user_ids, content    }: { user_ids: string; content: string }, context) {
    const endpoint = context.$client;
    const msgContent = { msgtype: 'text', text: { content } };
    const success = await endpoint.sendWorkNotice(user_ids.split(','), msgContent);
    return { success, message: success ? t(context.locale, 'workNoticeSent') : t(context.locale, 'sendFailed') };
  },
});

