import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { requireDiscordGatewayClient } from '../../src/client.js';
import { platformPermit } from '../../src/platform-permit.js';

export default defineAgentTool<{ guild_id: string; user_id: string; role_id: string }>({
  description: '移除成员的 Discord 角色',
  inputSchema: z.object({
    guild_id: z.string().describe('服务器 ID'),
    user_id: z.string().describe('用户 ID'),
    role_id: z.string().describe('角色 ID'),
  }),
  adapter: 'discord',
  tags: ['discord'],
  permissions: [platformPermit('manage_roles')],
  async execute({ guild_id, user_id, role_id  }: { guild_id: string; user_id: string; role_id: string }, context) {
    const client = requireDiscordGatewayClient(context.$client);
    const guild = await client.guilds.fetch(guild_id);
    const member = await guild.members.fetch(user_id) as {
      roles: { remove(id: string): Promise<unknown> };
    };
    await member.roles.remove(role_id);
    const success = true;
    return { success, message: success ? `已移除用户 ${user_id} 的角色` : '操作失败' };
  },
});
