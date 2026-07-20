import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';
import { getDiscordAgentDeps } from '../../src/discord-agent-deps.js';

export default defineAgentTool<{ endpoint_id: string; guild_id: string; user_id: string; role_id: string }>({
  description: '移除成员的 Discord 角色',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    guild_id: z.string().describe('服务器 ID'),
    user_id: z.string().describe('用户 ID'),
    role_id: z.string().describe('角色 ID'),
  }),
  platforms: ['discord'],
  tags: ['discord'],
  permissions: [platformPermit('manage_roles')],
  async execute({ endpoint_id, guild_id, user_id, role_id  }: { endpoint_id: string; guild_id: string; user_id: string; role_id: string }) {
    const endpoint = getDiscordAgentDeps().getGatewayEndpoint(endpoint_id) as {
      removeRole: (guildId: string, userId: string, roleId: string) => Promise<boolean>;
    };
    const success = await endpoint.removeRole(guild_id, user_id, role_id);
    return { success, message: success ? `已移除用户 ${user_id} 的角色` : '操作失败' };
  },
});
