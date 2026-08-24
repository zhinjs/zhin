import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import type { SlackUserInfo } from '../../src/client.js';

export default defineAgentTool<{
  user_id: string;
}>({
  description: '查询 Slack 用户详细信息',
  inputSchema: z.object({
    user_id: z.string().describe('用户 ID'),
  }),
  adapter: 'slack',
  tags: ['slack'],
  async execute({ user_id }, context) {
    const client = context.$client;
    const user = (await client.users.info({ user: user_id })).user as SlackUserInfo | undefined;
    if (!user) throw new Error(`Slack 用户不存在: ${user_id}`);
    return {
      id: user.id,
      name: user.name,
      real_name: user.real_name,
      display_name: user.profile?.display_name,
      email: user.profile?.email,
      is_admin: user.is_admin,
      is_bot: user.is_bot,
      status_text: user.profile?.status_text,
    };
  },
});
