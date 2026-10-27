import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { currentGroup } from '../../../../conversation.js';
import { messages as t } from '../../../../messages.js';

export default defineAgentTool({
  description: '让机器人退出当前 QQ 群；仅主人可发起且每次人工审批，机器人是群主时拒绝执行以免解散群',
  adapter: 'icqq',
  scopes: ['group'],
  permissions: ['role(master)'],
  requiresApproval: 'human',
  risk: 'dangerous',
  riskCategory: 'member',
  inputSchema: z.object({
    group_id: z.number().int().positive().describe('当前群号，展示于本次退群审批'),
    reason: z.string().min(1).describe('本次退群原因，供主人逐次确认'),
  }),
  async execute({ group_id }, context) {
    if (currentGroup(context) !== group_id) return { success: false, message: t(context.locale, 'leaveForbidden') };
    const client = context.$client;
    const [group, self] = await Promise.all([
      client.getGroupInfo(group_id, true),
      client.getGroupMemberInfo(group_id, client.uin, true),
    ]);
    if (group.owner_id === client.uin || (self.role !== 'admin' && self.role !== 'member')) {
      return { success: false, message: t(context.locale, 'leaveForbidden') };
    }
    context.signal.throwIfAborted();
    const success = await client.setGroupLeave(group_id);
    return { success, message: t(context.locale, success ? 'groupLeft' : 'leaveUnconfirmed') };
  },
});
