import { messages as t } from "../../../../messages.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ chat_id: string; user_ids: string }>({
  description: '向指定钉钉群聊添加成员（chatid 由钉钉旧版建群接口返回，与当前会话 ID 不同；仅全局层 zhin owner）',
  inputSchema: z.object({
    chat_id: z.string().describe('群聊 ID'),
    user_ids: z.string().describe('要添加的用户 ID 列表，逗号分隔'),
  }),
  adapter: 'dingtalk',
  scopes: ["group"],
  tags: ['dingtalk'],
  // The target is a legacy `chatid` that cannot be derived from the current conversation
  // (openConversationId), so the current group's platform standing cannot vouch for it: zhin owner only.
  permissions: ['owner@global'],
  async execute({ chat_id, user_ids    }: { chat_id: string; user_ids: string }, context) {
    const endpoint = context.$client;
    const success = await endpoint.updateChat(chat_id, { add_useridlist: user_ids.split(',') });
    return { success, message: success ? t(context.locale, 'membersAdded') : t(context.locale, 'addFailed') };
  },
});

