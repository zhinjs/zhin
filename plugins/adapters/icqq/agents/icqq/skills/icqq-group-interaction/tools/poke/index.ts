import { messages as t } from "../../../../messages.js";
import { currentGroup } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ user_id: number }>({
  description: '在当前 QQ 群中对某个成员执行戳一戳互动操作',
  inputSchema: z.object({
    user_id: z.number().describe('要戳的目标成员 QQ号'),
  }),
  adapter: 'icqq',
  scopes:['group'],
  requiresApproval: 'never',
  async execute({ user_id }, context) {
    await context.$client.sendGroupPoke(currentGroup(context), user_id);
    return { success: true, message: t(context.locale, 'poked', { p0: user_id }) };
  },
});
