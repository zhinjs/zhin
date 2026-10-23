import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
export default defineAgentTool<{ group_id: number; user_id: number; reason: string }>({
  description: '踢出 QQ 群中的某个成员',
  inputSchema: z.object({
    group_id: z.number().describe('目标群号'),
    user_id: z.number().describe('要踢出的成员 QQ号'),
    reason: z.string().min(1).describe('本次踢人的具体原因，随目标群和成员一起供人工确认'),
  }),
  adapter: 'icqq',
  scopes:['group'],
  permissions: ['role(master,admin,trusted,owner)'],
  requiresApproval: 'human',
  async execute({ group_id, user_id }, context) {
    const client = context.$client;
    const [self, member] = await Promise.all([
      client.getGroupMemberInfo(group_id, client.uin, true),
      client.getGroupMemberInfo(group_id, user_id, true),
    ]);
    if (user_id === client.uin || (self.role !== 'owner' && self.role !== 'admin')
      || member.role !== 'member') return { success: false, message: '当前权限或成员状态不允许踢出' };
    context.signal.throwIfAborted();
    if (!await client.setGroupKick(group_id, user_id)) return { success: false, message: '平台未确认踢出成功，请勿自动重试' };
    return { success: true, message: `已踢出 ${user_id} 成员` };
  },
});
