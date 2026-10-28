import { messages as t } from "../../../../messages.js";
import { freshMember } from "../../../../members.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ group_id: number; user_id: number }>({
  description: '邀请好友加入 QQ 群',
  inputSchema: z.object({
    group_id: z.number().describe('目标群号'),
    user_id: z.number().describe('要邀请的 QQ号'),
  }),
  adapter: 'icqq',
  scopes: ["group"],
  requiresApproval: 'always',
  async execute({ group_id, user_id }, context) {
    const client = context.$client;
    const groupInfo= client.pickGroup(group_id);
    if(!groupInfo) return { success: false, message: t(context.locale, 'groupMissing') };
    if (await freshMember(client, group_id, user_id)) return { success: false, message: t(context.locale, 'memberExists') };
    await client.inviteFriend(group_id, user_id);
    return { success: true, message: t(context.locale, 'inviteAttempted', { p0: user_id, p1: group_id }) };
  },
});
