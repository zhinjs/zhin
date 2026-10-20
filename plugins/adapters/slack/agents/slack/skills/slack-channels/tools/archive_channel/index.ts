import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { platformPermission } from '@zhin.js/permission';

export default defineAgentTool<{
  channel: string;
}>({
  description: '归档 Slack 频道',
  inputSchema: z.object({
    channel: z.string().describe('频道 ID'),
  }),
  adapter: 'slack',
  tags: ['slack'],
  permissions: [platformPermission('slack', 'workspace_admin')],
  async execute({ channel }, context) {
    const client = context.$client;
    await client.conversations.archive({ channel });
    const success = true;
    return { success, message: success ? '已归档频道' : '操作失败' };
  },
});
