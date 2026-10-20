import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { platformPermission } from '@zhin.js/permission';

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
  permissions: [platformPermission('slack', 'channel_manager')],
  async execute({ channel, topic }, context) {
    const client = context.$client;
    await client.conversations.setTopic({ channel, topic });
    const success = true;
    return { success, message: success ? '已设置频道话题' : '操作失败' };
  },
});
