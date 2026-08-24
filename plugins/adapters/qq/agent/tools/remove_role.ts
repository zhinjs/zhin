import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';

export default defineAgentTool<{ guild_id: string; channel_id: string; user_id: string; role_id: string }>({
  description: '移除成员的 QQ 频道角色',
  inputSchema: z.object({
    guild_id: z.string().describe('频道 ID'),
    channel_id: z.string().describe('子频道 ID'),
    user_id: z.string().describe('用户 ID'),
    role_id: z.string().describe('角色 ID'),
  }),
  adapter: 'qq',
  tags: ['qq'],
  permissions: [platformPermit('manage_roles')],
  async execute({ guild_id, channel_id, user_id, role_id  }: { guild_id: string; channel_id: string; user_id: string; role_id: string }, context) {
    const client = context.$client;
    const success = await client.removeMemberRole(guild_id, channel_id, user_id, role_id);
    return { success, message: success ? '已移除成员的角色' : '操作失败' };
  },
});
