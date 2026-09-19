import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';

export default defineAgentTool<{ guild_id: string; role_id: string }>({
  description: '删除 KOOK 服务器中的角色',
  inputSchema: z.object({
    guild_id: z.string().describe('服务器 ID'),
    role_id: z.string().describe('角色 ID'),
  }),
  adapter: 'kook',
  tags: ['kook'],
  permissions: [platformPermit('guild_owner')],
  async execute({ guild_id, role_id  }: { guild_id: string; role_id: string }, context) {
    const client = context.$client;
    const success = await client.pickGuild(guild_id).deleteRole(role_id);
    return { success, message: success ? `已删除角色 ${role_id}` : '删除角色失败' };
  },
});
