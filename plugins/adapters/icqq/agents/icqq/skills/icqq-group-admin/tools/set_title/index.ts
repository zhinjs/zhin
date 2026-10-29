import { messages as t } from "../../../../messages.js";
import { freshMember, isGroupManager } from "../../../../members.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ group_id: number; user_id: number; title: string; duration?: number }>({
  description: '设置 QQ 群成员的专属头衔',
  inputSchema: z.object({
    group_id: z.number().describe('目标群号'),
    user_id: z.number().describe('目标成员 QQ号'),
    title: z.string().describe('头衔文字'),
    duration: z.number().optional().describe('持续时间(秒)，-1永久').default(-1),
  }),
  adapter: 'icqq',
  // ADR 0044: offered only while the Bot can actually do this here (e.g. it is a group admin).
  requiresCapabilities: ['actions.setTitle'],
  scopes:['group'],
  requiresApproval: 'always',
  async execute({ group_id, user_id, title, duration }, context) {
    const client = context.$client;
    const [self, member] = await Promise.all([freshMember(client, group_id, client.uin), freshMember(client, group_id, user_id)]);
    if (!isGroupManager(self)) return { success: false, message: t(context.locale, 'titleForbidden') };
    if (!member) return { success: false, message: t(context.locale, 'memberMissing') };
    await client.setGroupSpecialTitle(group_id, user_id, title, duration ?? -1);
    return { success: true, message: t(context.locale, 'titleChanged', { p0: user_id, p1: title }) };
  },
});
