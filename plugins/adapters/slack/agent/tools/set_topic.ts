import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { platformPermit } from '../../src/platform-permit.js';
import { getSlackAgentDeps } from '../../src/slack-agent-deps.js';

export default defineTool<{
  endpoint_id: string;
  channel: string;
  topic: string;
}>({
  description: '设置 Slack 频道话题',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    channel: z.string().describe('频道 ID'),
    topic: z.string().describe('新话题'),
  }),
  platforms: ['slack'],
  tags: ['slack'],
  permissions: [platformPermit('channel_manager')],
  async execute({ endpoint_id, channel, topic }) {
    const { getEndpoint } = getSlackAgentDeps();
    const endpoint = getEndpoint(endpoint_id);
    const success = await endpoint.setChannelTopic(channel, topic);
    return { success, message: success ? '已设置频道话题' : '操作失败' };
  },
});
