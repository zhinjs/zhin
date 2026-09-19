import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';

export default defineAgentTool<{
  channel_id: string;
  purpose: string;
}>({
  description: '设置 Slack 频道的用途/目的',
  inputSchema: z.object({
    channel_id: z.string().describe('频道 ID'),
    purpose: z.string().describe('频道用途描述'),
  }),
  adapter: 'slack',
  tags: ['slack'],
  permissions: [platformPermit('channel_manager')],
  async execute({ channel_id, purpose }, context) {
    const client = context.$client;
    await client.conversations.setPurpose({ channel: channel_id, purpose });
    const success = true;
    return { success, message: success ? '频道用途已更新' : '操作失败' };
  },
});
