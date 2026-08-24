import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';

export default defineAgentTool<{
  channel: string;
  timestamp: string;
}>({
  description: '置顶 Slack 消息',
  inputSchema: z.object({
    channel: z.string().describe('频道 ID'),
    timestamp: z.string().describe('消息时间戳'),
  }),
  adapter: 'slack',
  tags: ['slack'],
  permissions: [platformPermit('channel_manager')],
  async execute({ channel, timestamp }, context) {
    const client = context.$client;
    await client.pins.add({ channel, timestamp });
    const success = true;
    return { success, message: success ? '已置顶消息' : '操作失败' };
  },
});
