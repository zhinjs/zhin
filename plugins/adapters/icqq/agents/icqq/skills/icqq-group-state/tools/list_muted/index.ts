import { currentGroup } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<Record<string, never>>({
  description: '查询当前 QQ 群中当前被禁言的成员列表',
  inputSchema: z.object({}),
  adapter: 'icqq',
  scopes:['group'],
  requiresApproval: 'never',
  async execute(_input, context) {
    const members = await context.$client.getGroupMemberList(currentGroup(context));
    const now = Math.floor(Date.now() / 1000);
    const muted = Array.from(members.values()).filter((m) => m.shutup_time > now);
    return { muted_members: muted, count: muted.length };
  },
});
