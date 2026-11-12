import { messages as t } from "../../../../messages.js";
import { currentGroup } from "../../../../conversation.js";
import { freshMember, isGroupManager } from "../../../../members.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ user_id: number; duration?: number }>({
  description: '禁言/解除禁言当前 QQ 群的指定成员',
  inputSchema: z.object({
    user_id: z.number().describe('目标成员 QQ号'),
    duration: z.number().describe('禁言时间(秒)，0=解除禁言').default(0),
  }),
  adapter: 'icqq',
  // ADR 0044: offered only while the Bot can actually do this here (e.g. it is a group admin).
  requiresCapabilities: ['actions.mute'],
  scopes:['group'],
  permissions: ['platform:admin', 'bot:admin'],
  requiresApproval: 'always',
  async execute({ user_id, duration }, context) {
    const group_id = currentGroup(context);
    const client = context.$client;
    const [self, member] = await Promise.all([freshMember(client, group_id, client.uin), freshMember(client, group_id, user_id)]);
    if (!isGroupManager(self)) return { success: false, message: t(context.locale, 'muteForbidden') };
    if (!member) return { success: false, message: t(context.locale, 'memberMissing') };
    await client.setGroupBan(group_id, user_id, duration === 0 ? 0 : duration);
    return { success: true, message: duration === 0 ? t(context.locale, 'unmuted', { user: user_id }) : t(context.locale, 'muted', { user: user_id, seconds: duration ?? 0 }) };
  },
});
