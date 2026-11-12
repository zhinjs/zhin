import { messages as t } from "../../../../messages.js";
import { currentGroup } from '../../../../conversation.js';
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ user_id: number; title: string }>({
  description: '设置当前群成员的专属头衔。需要群主权限。',
  inputSchema: z.object({
    user_id: z.number().describe('目标成员 QQ 号'),
    title: z.string().describe('头衔文字'),
  }),
  adapter: 'napcat',
  tags: ['napcat', 'qq'],
  keywords: ['头衔', 'title', '专属头衔', '设置头衔'],
  permissions: ['platform:owner', 'bot:owner'],
  scopes: ['group'],
  async execute({ user_id, title }, context) {
    const endpoint = context.$client;
      await endpoint.setTitle({ groupId: currentGroup(context), userId: user_id, title });
      return { success: true, message: t(context.locale, 'memberTitleSet', { p0: user_id, p1: title }) };
  },
});
