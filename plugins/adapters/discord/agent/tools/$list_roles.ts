import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { requireDiscordGatewayClient } from '../../src/client.js';
import { platformPermit } from '../../src/platform-permit.js';

export default defineAgentTool<{ guild_id: string }>({
  description: '获取 Discord 服务器角色列表',
  inputSchema: z.object({
    guild_id: z.string().describe('服务器 ID'),
  }),
  adapter: 'discord',
  tags: ['discord'],
  permissions: [platformPermit('manage_roles')],
  async execute({ guild_id  }: { guild_id: string }, context) {
    const client = requireDiscordGatewayClient(context.$client);
    const guild = await client.guilds.fetch(guild_id);
    await guild.roles.fetch();
    const cache = guild.roles.cache as Map<string, {
      id: string;
      name: string;
      hexColor: string;
      position: number;
      permissions: { bitfield: bigint };
    }>;
    const roles = [...cache.values()].map((role) => ({
      id: role.id,
      name: role.name,
      color: role.hexColor,
      position: role.position,
      permissions: role.permissions.bitfield.toString(),
    }));
    return { roles, count: roles.length };
  },
});
