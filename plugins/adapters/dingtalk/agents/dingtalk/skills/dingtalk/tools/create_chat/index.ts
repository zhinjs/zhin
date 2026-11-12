import { messages as t } from "../../../../messages.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ name: string; owner: string; members: string }>({
  description: '创建钉钉群聊',
  inputSchema: z.object({
    name: z.string().describe('群名'),
    owner: z.string().describe('群主用户 ID'),
    members: z.string().describe('成员用户 ID 列表，逗号分隔'),
  }),
  adapter: 'dingtalk',
  tags: ['dingtalk'],
  // A new group does not depend on any standing in the current group; DingTalk never reports a
  // `chat_owner` permission either. `trusted` is also met by zhin `admin` / `owner` (ADR 0056 §2).
  permissions: ['trusted'],
  async execute({ name, owner, members    }: { name: string; owner: string; members: string }, context) {
    const endpoint = context.$client;
    const chatId = await endpoint.createChat(name, owner, members.split(','));
    return { success: !!chatId, chat_id: chatId, message: chatId ? t(context.locale, 'chatCreated', { p0: chatId }) : t(context.locale, 'createFailed') };
  },
});

