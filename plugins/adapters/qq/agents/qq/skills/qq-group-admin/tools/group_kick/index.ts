import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { currentGroup, kickQqGroupMember, requireGroupManager } from '../../../../conversation.js';
import { messages as t } from '../../../../messages.js';

export default defineAgentTool({
  description: '把当前 QQ 群中的普通成员移出群，可选同时拉黑；每次人工审批，官方白名单能力',
  adapter: 'qq',
  scopes: ['group'],
  permissions: ['role(master,admin,trusted,owner)'],
  requiresApproval: 'human',
  risk: 'dangerous',
  riskCategory: 'member',
  inputSchema: z.object({
    user_id: z.string().min(1).describe('要移出的成员 member_openid'),
    reason: z.string().min(1).describe('本次移出的具体原因，随目标成员一起供人工确认'),
    blacklist: z.boolean().default(false).describe('是否同时加入群黑名单'),
  }),
  async execute({ user_id, blacklist }, context) {
    const group = currentGroup(context);
    const client = context.$client;
    const [self, member] = await Promise.all([
      requireGroupManager(context, group),
      client.groupService.getMemberInfo(group, user_id),
    ]);
    if (!self) return { success: false, message: t(context.locale, 'botNotManager') };
    if (member.member_openid !== user_id || member.member_role !== 'member' || member.bot || user_id === self.member_openid) {
      return { success: false, message: t(context.locale, 'targetNotMember') };
    }
    context.signal.throwIfAborted();
    const { blacklistFailed } = await kickQqGroupMember(client, group, user_id, blacklist === true);
    return {
      success: true,
      message: t(context.locale, 'memberKicked', { p0: member.username || user_id }),
      ...(blacklistFailed ? { warning: t(context.locale, 'blacklistFailed') } : {}),
    };
  },
});
