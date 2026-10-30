import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { currentGroup, requireGroupManager } from '../../../../conversation.js';
import { messages as t } from '../../../../messages.js';

export default defineAgentTool({
  description: '通过或拒绝当前 QQ 群的一条入群申请；每次人工审批，需机器人为群管理员，官方白名单能力',
  adapter: 'qq',
  scopes: ['group'],
  permissions: ['role(master,admin,trusted,owner)'],
  requiresApproval: 'human',
  risk: 'dangerous',
  riskCategory: 'member',
  inputSchema: z.object({
    user_id: z.string().min(1).describe('申请人 member_openid（来自 list_join_requests 或入群申请事件）'),
    join_request_id: z.string().min(1).optional().describe('申请 ID（list_join_requests 返回的 join_request_id）'),
    approve: z.boolean().describe('true 通过，false 拒绝'),
    reason: z.string().optional().describe('拒绝理由（仅拒绝时发送）'),
    blacklist: z.boolean().default(false).describe('拒绝时是否同时拉黑'),
  }),
  async execute({ user_id, join_request_id, approve, reason, blacklist }, context) {
    const group = currentGroup(context);
    if (!await requireGroupManager(context, group)) return { success: false, message: t(context.locale, 'botNotManager') };
    await context.$client.groupService.approveJoinRequest(group, user_id, {
      op: approve ? 'approve' : 'decline',
      ...(join_request_id ? { join_request_id } : {}),
      ...(!approve && reason ? { reject_reason: reason } : {}),
      ...(!approve && blacklist ? { add_to_member_blacklist: true } : {}),
    });
    return { success: true, message: t(context.locale, approve ? 'joinApproved' : 'joinDeclined', { user: user_id }) };
  },
});
