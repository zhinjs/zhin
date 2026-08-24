import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';

export default defineAgentTool<{ guild_id: string; name: string }>({
  description: '在 KOOK 服务器中创建新角色',
  inputSchema: z.object({
    guild_id: z.string().describe('服务器 ID'),
    name: z.string().describe('角色名称'),
  }),
  adapter: 'kook',
  tags: ['kook'],
  permissions: [platformPermit('guild_owner')],
  async execute({ guild_id, name  }: { guild_id: string; name: string }, context) {
    const client = context.$client;
    const role = await client.pickGuild(guild_id).createRole(name);
    return {
      success: true,
      message: `已创建角色 "${name}"`,
      role: { id: role.role_id, name: role.name },
    };
  },
});
