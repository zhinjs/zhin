import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';

export default defineAgentTool<{
  channel: string;
  topic: string;
}>({
  description: '设置 Slack 频道话题',
  inputSchema: z.object({
    channel: z.string().describe('频道 ID'),
    topic: z.string().describe('新话题'),
  }),
  adapter: 'slack',
  tags: ['slack'],
  permissions: [platformPermit('channel_manager')],
  async execute({ channel, topic }, context) {
    const client = context.$client;
    await client.conversations.setTopic({ channel, topic });
    const success = true;
    return { success, message: success ? '已设置频道话题' : '操作失败' };
  },
});
