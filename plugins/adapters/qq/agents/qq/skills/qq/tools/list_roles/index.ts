import { currentGuildChannel } from '../../../../conversation.js';
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<Record<string, never>>({
  description: '获取当前 QQ 频道的身份组列表',
  inputSchema: z.object({}),
  adapter: 'qq',
  scopes: ["channel"],
  tags: ['qq'],
  permissions: ['platform:admin'],
  async execute(_args, context) {
    const { guildId: guild_id } = currentGuildChannel(context);
    const client = context.$client;
    const roles = await client.guildService.getRoles(guild_id);
    return { roles, count: roles.length };
  },
});
