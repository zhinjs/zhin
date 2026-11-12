import { messages as t } from "../../../../messages.js";
import { currentGroup } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<Record<string, never>>({
  description: '在当前 QQ 群签到/打卡',
  inputSchema: z.object({}),
  adapter: 'icqq',
  scopes:['group'],
  requiresApproval: 'never',
  async execute(_input, context) {
    const group_id = currentGroup(context);
    const client = context.$client;
    const groupInfo= client.pickGroup(group_id);
    if(!groupInfo) return { success: false, message: t(context.locale, 'groupMissing') };
    await client.sendGroupSign(group_id);
    return { success: true, message: t(context.locale, 'checkedIn') };
  },
});
