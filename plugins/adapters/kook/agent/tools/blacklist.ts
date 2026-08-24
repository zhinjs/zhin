import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';

export default defineAgentTool<{ guild_id: string; action: 'add' | 'remove'; user_id: string; remark?: string }>({
  description: 'KOOK 服务器黑名单管理：添加/移除',
  inputSchema: z.object({
    guild_id: z.string().describe('服务器 ID'),
    action: z.enum(['add', 'remove']).describe('add|remove'),
    user_id: z.string().describe('用户 ID'),
    remark: z.string().optional().describe('备注（add 可选）'),
  }),
  adapter: 'kook',
  tags: ['kook'],
  permissions: [platformPermit('guild_admin')],
  async execute({ guild_id, action, user_id, remark }: { guild_id: string; action: 'add' | 'remove'; user_id: string; remark?: string }, context) {
    const member = context.$client.pickGuildMember(guild_id, user_id);
    switch (action) {
      case 'add': {
        const success = await member.addToBlackList(remark);
        return { success, message: success ? `已将 ${user_id} 加入黑名单` : '操作失败' };
      }
      case 'remove': {
        const success = await member.removeFromBlackList();
        return { success, message: success ? `已将 ${user_id} 从黑名单移除` : '操作失败' };
      }
      default:
        return { success: false, message: `未知操作: ${action}` };
    }
  },
});
