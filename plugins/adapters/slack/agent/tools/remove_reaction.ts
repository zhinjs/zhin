import { defineTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getSlackAgentDeps } from '../../src/slack-agent-deps.js';

export default defineTool<{
  endpoint_id: string;
  channel_id: string;
  timestamp: string;
  name: string;
}>({
  description: '移除 Slack 消息上的表情反应',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    channel_id: z.string().describe('频道 ID'),
    timestamp: z.string().describe('消息时间戳'),
    name: z.string().describe('表情名称（如 thumbsup、heart）'),
  }),
  platforms: ['slack'],
  tags: ['slack'],
  async execute({ endpoint_id, channel_id, timestamp, name }) {
    const { getEndpoint } = getSlackAgentDeps();
    const endpoint = getEndpoint(endpoint_id);
    const success = await endpoint.removeReaction(channel_id, timestamp, name);
    return { success, message: success ? `已移除反应 :${name}:` : '操作失败' };
  },
});
