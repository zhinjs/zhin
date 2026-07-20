import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';
import { getKookAgentDeps } from '../../src/kook-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; guild_id: string; user_id: string; role_id: string }>({
  description: '撤销用户的 KOOK 服务器角色',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    guild_id: z.string().describe('服务器 ID'),
    user_id: z.string().describe('用户 ID'),
    role_id: z.string().describe('角色 ID'),
  }),
  platforms: ['kook'],
  tags: ['kook'],
  permissions: [platformPermit('manage_roles')],
  async execute({ endpoint_id, guild_id, user_id, role_id  }: { endpoint_id: string; guild_id: string; user_id: string; role_id: string }) {
    const endpoint = getKookAgentDeps().getEndpoint(endpoint_id);
    const success = await endpoint.revokeRole(guild_id, user_id, role_id);
    return { success, message: success ? `已撤销用户 ${user_id} 的角色 ${role_id}` : '撤销角色失败' };
  },
});
