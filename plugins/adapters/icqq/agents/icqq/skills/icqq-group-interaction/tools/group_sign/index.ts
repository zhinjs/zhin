import { messages as t } from "../../../../messages.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ group_id: number }>({
  description: 'QQ 群签到/打卡',
  inputSchema: z.object({
    group_id: z.number().describe('目标群号'),
  }),
  adapter: 'icqq',
  scopes:['group'],
  requiresApproval: 'never',
  async execute({ group_id }, context) {
    const client = context.$client;
    const groupInfo= client.pickGroup(group_id);
    if(!groupInfo) return { success: false, message: t(context.locale, 'groupMissing') };
    await client.sendGroupSign(group_id);
    return { success: true, message: t(context.locale, 'checkedIn') };
  },
});
