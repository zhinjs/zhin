import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';

export default defineAgentTool<{ guild_id: string; user_id: string }>({
  description: '获取 QQ 频道中指定成员的详细信息',
  inputSchema: z.object({
    guild_id: z.string().describe('频道 ID'),
    user_id: z.string().describe('用户 ID'),
  }),
  adapter: 'qq',
  tags: ['qq'],
  permissions: [platformPermit('guild_admin')],
  async execute({ guild_id, user_id  }: { guild_id: string; user_id: string }, context) {
    const client = context.$client;
    return client.getGuildMember(guild_id, user_id);
  },
});
