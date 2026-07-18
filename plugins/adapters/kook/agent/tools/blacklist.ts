import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';
import { getKookAgentDeps } from '../../src/kook-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; guild_id: string; action: 'add' | 'remove'; user_id: string; remark?: string }>({
  description: 'KOOK 服务器黑名单管理：添加/移除',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    guild_id: z.string().describe('服务器 ID'),
    action: z.enum(['add', 'remove']).describe('add|remove'),
    user_id: z.string().describe('用户 ID'),
    remark: z.string().optional().describe('备注（add 可选）'),
  }),
  platforms: ['kook'],
  tags: ['kook'],
  permissions: [platformPermit('guild_admin')],
  async execute({ endpoint_id, guild_id, action, user_id, remark }: { endpoint_id: string; guild_id: string; action: 'add' | 'remove'; user_id: string; remark?: string }) {
    const endpoint = getKookAgentDeps().getEndpoint(endpoint_id);
    switch (action) {
      case 'add': {
        const success = await endpoint.addToBlacklist(guild_id, user_id, remark);
        return { success, message: success ? `已将 ${user_id} 加入黑名单` : '操作失败' };
      }
      case 'remove': {
        const success = await endpoint.removeFromBlacklist(guild_id, user_id);
        return { success, message: success ? `已将 ${user_id} 从黑名单移除` : '操作失败' };
      }
      default:
        return { success: false, message: `未知操作: ${action}` };
    }
  },
});
