import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ guild_id: string }>({
  description: '获取 QQ 频道角色列表',
  inputSchema: z.object({
    guild_id: z.string().describe('频道 ID'),
  }),
  adapter: 'qq',
  scopes: ["channel"],
  tags: ['qq'],
  permissions: ['platform:admin'],
  async execute({ guild_id  }: { guild_id: string }, context) {
    const client = context.$client;
    const roles = await client.guildService.getRoles(guild_id);
    return { roles, count: roles.length };
  },
});
