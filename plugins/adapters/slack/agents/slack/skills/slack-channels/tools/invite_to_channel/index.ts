import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { platformPermission } from '@zhin.js/permission';

export default defineAgentTool<{
  channel: string;
  users: string;
}>({
  description: '邀请用户加入 Slack 频道',
  inputSchema: z.object({
    channel: z.string().describe('频道 ID'),
    users: z.string().describe('用户 ID 列表（逗号分隔）'),
  }),
  adapter: 'slack',
  tags: ['slack'],
  permissions: [platformPermission('slack', 'channel_manager')],
  async execute({ channel, users }, context) {
    const client = context.$client;
    await client.conversations.invite({ channel, users });
    const success = true;
    return { success, message: success ? '已邀请用户加入频道' : '操作失败' };
  },
});
