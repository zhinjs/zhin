import { messages as t } from "../../../../messages.js";
import { freshMember } from "../../../../members.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ group_id: number; user_id: number; enabled: boolean; reason: string }>({
  description: '设置或取消 QQ 群管理员（enabled=true 设为管理员，false 取消管理员）；仅你是该群群主时可用，每次人工审批',
  inputSchema: z.object({
    group_id: z.number().describe('目标群号'),
    user_id: z.number().describe('目标成员 QQ号'),
    enabled: z.boolean().describe('true 设为管理员（目标须为普通成员）；false 取消管理员（目标须为现任管理员）'),
    reason: z.string().min(1).describe('本次设置或取消管理员的具体原因，随目标群和成员一起供人工确认'),
  }),
  adapter: 'icqq',
  scopes: ['group'],
  requiresCapabilities: ['actions.setAdmin'],
  currentConversationBotRoles: ['owner'],
  permissions: ['trusted'],
  requiresApproval: 'human',
  async execute({ group_id, user_id, enabled }, context) {
    const client = context.$client;
    if (user_id === client.uin) return { success: false, message: t(context.locale, 'adminForbidden') };
    const [self, member] = await Promise.all([freshMember(client, group_id, client.uin), freshMember(client, group_id, user_id)]);
    if (self?.role !== 'owner') return { success: false, message: t(context.locale, 'adminForbidden') };
    if (!member) return { success: false, message: t(context.locale, 'memberMissing') };
    if (member.role !== (enabled ? 'member' : 'admin')) return { success: false, message: t(context.locale, 'adminTargetInvalid') };
    context.signal.throwIfAborted();
    let confirmed = false;
    try {
      confirmed = await client.setGroupAdmin(group_id, user_id, enabled);
    } catch {
      confirmed = false;
    }
    if (!confirmed) return { success: false, message: t(context.locale, 'adminUnconfirmed') };
    return { success: true, message: t(context.locale, enabled ? 'adminSet' : 'adminUnset', { p0: user_id }) };
  },
});
