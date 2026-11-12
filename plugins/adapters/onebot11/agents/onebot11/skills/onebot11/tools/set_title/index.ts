import { messages as t } from "../../../../messages.js";
import { currentGroup } from '../../../../conversation.js';
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ user_id: number; title: string }>({
  description: '设置当前 QQ 群成员的专属头衔。只有群主才能设置。',
  inputSchema: z.object({
    user_id: z.number().describe('目标成员 QQ号'),
    title: z.string().describe('头衔文字'),
  }),
  adapter: 'onebot11',
  scopes: ["group"],
  tags: ['onebot11'],
  permissions: ['platform:owner', 'bot:owner'],
  async execute({ user_id, title }, context) {
    const group_id = currentGroup(context);
    const client = context.$client;
    const response = await client.call('set_group_special_title', {
      group_id,
      user_id,
      special_title: title,
      duration: -1,
    });
    const success = response.status === 'ok';
    return { success, message: success ? t(context.locale, 'titleChanged', { p0: user_id, p1: title }) : t(context.locale, 'setFailed') };
  },
});
