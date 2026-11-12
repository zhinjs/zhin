import { messages as t } from "../../../../messages.js";
import { currentGuildChannel, requireRoleBelowRequester } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { requireDiscordGatewayClient } from '@zhin.js/adapter-discord';

export default defineAgentTool<{ user_id: string; role_id: string }>({
  description: '移除当前 Discord 服务器成员的身份组（只能是低于你最高身份组的身份组）',
  inputSchema: z.object({
    user_id: z.string().describe('用户 ID'),
    role_id: z.string().describe('身份组 ID'),
  }),
  adapter: 'discord',
  scopes: ["channel"],
  tags: ['discord'],
  permissions: ['platform-permission:manage_roles', 'bot-permission:manage_roles'],
  async execute({ user_id, role_id }, context) {
    const { guildId } = currentGuildChannel(context);
    const client = requireDiscordGatewayClient(context.$client);
    const guild = await client.guilds.fetch(guildId);
    const denied = await requireRoleBelowRequester(context, guild, role_id);
    if (denied) return { success: false, message: denied };
    const member = await guild.members.fetch(user_id) as {
      roles: { remove(id: string): Promise<unknown> };
    };
    await member.roles.remove(role_id);
    return { success: true, message: t(context.locale, 'memberRoleRemoved', { p0: user_id }) };
  },
});
