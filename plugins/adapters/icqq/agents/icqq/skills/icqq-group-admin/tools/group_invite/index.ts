import { messages as t } from "../../../../messages.js";
import { freshMember } from "../../../../members.js";
import { currentGroup } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ user_id: number }>({
  description: '邀请你的好友加入当前 QQ 群',
  inputSchema: z.object({
    user_id: z.number().describe('要邀请的 QQ号'),
  }),
  adapter: 'icqq',
  scopes: ["group"],
  requiresApproval: 'always',
  async execute({ user_id }, context) {
    const group_id = currentGroup(context);
    const client = context.$client;
    const groupInfo= client.pickGroup(group_id);
    if(!groupInfo) return { success: false, message: t(context.locale, 'groupMissing') };
    if (await freshMember(client, group_id, user_id)) return { success: false, message: t(context.locale, 'memberExists') };
    await client.inviteFriend(group_id, user_id);
    return { success: true, message: t(context.locale, 'inviteAttempted', { p0: user_id, p1: group_id }) };
  },
});
