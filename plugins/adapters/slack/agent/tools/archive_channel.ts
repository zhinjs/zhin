import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';

export default defineAgentTool<{
  channel: string;
}>({
  description: '归档 Slack 频道',
  inputSchema: z.object({
    channel: z.string().describe('频道 ID'),
  }),
  adapter: 'slack',
  tags: ['slack'],
  permissions: [platformPermit('workspace_admin')],
  async execute({ channel }, context) {
    const client = context.$client;
    await client.conversations.archive({ channel });
    const success = true;
    return { success, message: success ? '已归档频道' : '操作失败' };
  },
});
