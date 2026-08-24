import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';

export default defineAgentTool<{ guild_id: string; user_id: string; role_id: string }>({
  description: '给用户授予 KOOK 服务器角色',
  inputSchema: z.object({
    guild_id: z.string().describe('服务器 ID'),
    user_id: z.string().describe('用户 ID'),
    role_id: z.string().describe('角色 ID'),
  }),
  adapter: 'kook',
  tags: ['kook'],
  permissions: [platformPermit('manage_roles')],
  async execute({ guild_id, user_id, role_id  }: { guild_id: string; user_id: string; role_id: string }, context) {
    const client = context.$client;
    const success = await client.pickGuildMember(guild_id, user_id).grant(role_id);
    return { success, message: success ? `已授予用户 ${user_id} 角色 ${role_id}` : '授予角色失败' };
  },
});
