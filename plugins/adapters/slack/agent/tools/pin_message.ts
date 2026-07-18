import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';
import { getSlackAgentDeps } from '../../src/slack-agent-deps.js';

export default defineAgentTool<{
  endpoint_id: string;
  channel: string;
  timestamp: string;
}>({
  description: '置顶 Slack 消息',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    channel: z.string().describe('频道 ID'),
    timestamp: z.string().describe('消息时间戳'),
  }),
  platforms: ['slack'],
  tags: ['slack'],
  permissions: [platformPermit('channel_manager')],
  async execute({ endpoint_id, channel, timestamp }) {
    const { getEndpoint } = getSlackAgentDeps();
    const endpoint = getEndpoint(endpoint_id);
    const success = await endpoint.pinMessage(channel, timestamp);
    return { success, message: success ? '已置顶消息' : '操作失败' };
  },
});
