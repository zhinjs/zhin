import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ guild_id: string }>({
  description: '获取 KOOK 服务器的角色列表',
  inputSchema: z.object({
    guild_id: z.string().describe('服务器 ID'),
  }),
  adapter: 'kook',
  tags: ['kook'],
  async execute({ guild_id  }: { guild_id: string }, context) {
    const client = context.$client;
    const roles = await client.pickGuild(guild_id).getRoleList();
    return {
      roles: roles.map((r) => ({
        id: String(r.role_id),
        name: r.name,
        color: r.color,
        position: r.position,
        permissions: r.permissions,
      })),
      count: roles.length,
    };
  },
});
