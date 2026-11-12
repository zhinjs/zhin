import { currentGuildChannel } from '../../../../conversation.js';
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { requireDiscordGatewayClient } from '@zhin.js/adapter-discord';

export default defineAgentTool<Record<string, never>>({
  description: '获取当前 Discord 服务器的身份组列表',
  inputSchema: z.object({}),
  adapter: 'discord',
  scopes: ["channel"],
  tags: ['discord'],
  permissions: ['platform-permission:manage_roles'],
  async execute(_args, context) {
    const { guildId } = currentGuildChannel(context);
    const client = requireDiscordGatewayClient(context.$client);
    const guild = await client.guilds.fetch(guildId);
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
