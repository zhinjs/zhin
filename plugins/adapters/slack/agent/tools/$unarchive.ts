import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';

export default defineAgentTool<{
  channel_id: string;
}>({
  description: '恢复已归档的 Slack 频道',
  inputSchema: z.object({
    channel_id: z.string().describe('频道 ID'),
  }),
  adapter: 'slack',
  tags: ['slack'],
  permissions: [platformPermit('workspace_admin')],
  async execute({ channel_id }, context) {
    const client = context.$client;
    await client.conversations.unarchive({ channel: channel_id });
    const success = true;
    return { success, message: success ? '频道已恢复' : '操作失败' };
  },
});
