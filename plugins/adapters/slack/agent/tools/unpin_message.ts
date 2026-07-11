import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';
import { getSlackAgentDeps } from '../../src/slack-agent-deps.js';

export default defineTool<{
  endpoint_id: string;
  channel_id: string;
  timestamp: string;
}>({
  description: '取消 Slack 频道中消息的置顶',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    channel_id: z.string().describe('频道 ID'),
    timestamp: z.string().describe('消息时间戳'),
  }),
  platforms: ['slack'],
  tags: ['slack'],
  permissions: [platformPermit('channel_manager')],
  async execute({ endpoint_id, channel_id, timestamp }) {
    const { getEndpoint } = getSlackAgentDeps();
    const endpoint = getEndpoint(endpoint_id);
    const success = await endpoint.unpinMessage(channel_id, timestamp);
    return { success, message: success ? '已取消置顶' : '操作失败' };
  },
});
