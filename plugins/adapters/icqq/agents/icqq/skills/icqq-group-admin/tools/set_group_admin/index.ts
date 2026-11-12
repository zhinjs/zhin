import { messages as t } from "../../../../messages.js";
import { currentGroup } from "../../../../conversation.js";
import { freshMember } from "../../../../members.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ user_id: number; enabled: boolean; reason: string }>({
  description: '设置或取消当前 QQ 群管理员（enabled=true 设为管理员，false 取消管理员）；仅你是本群群主时可用，每次人工审批',
  inputSchema: z.object({
    user_id: z.number().describe('目标成员 QQ号'),
    enabled: z.boolean().describe('true 设为管理员（目标须为普通成员）；false 取消管理员（目标须为现任管理员）'),
    reason: z.string().min(1).describe('本次设置或取消管理员的具体原因，随目标成员一起供人工确认'),
  }),
  adapter: 'icqq',
  scopes: ['group'],
  requiresCapabilities: ['actions.setAdmin'],
  permissions: ['platform:owner', 'bot:owner'],
  requiresApproval: 'human',
  async execute({ user_id, enabled }, context) {
    const group_id = currentGroup(context);
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
