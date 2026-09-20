import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { platformPermission } from '@zhin.js/permission';

export default defineAgentTool<{
  channel_id: string;
  timestamp: string;
}>({
  description: '取消 Slack 频道中消息的置顶',
  inputSchema: z.object({
    channel_id: z.string().describe('频道 ID'),
    timestamp: z.string().describe('消息时间戳'),
  }),
  adapter: 'slack',
  tags: ['slack'],
  permissions: [platformPermission('slack', 'channel_manager')],
  async execute({ channel_id, timestamp }, context) {
    const client = context.$client;
    await client.pins.remove({ channel: channel_id, timestamp });
    const success = true;
    return { success, message: success ? '已取消置顶' : '操作失败' };
  },
});
