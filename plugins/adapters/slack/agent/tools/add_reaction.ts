import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getSlackAgentDeps } from '../../src/slack-agent-deps.js';

export default defineAgentTool<{
  endpoint_id: string;
  channel: string;
  timestamp: string;
  emoji: string;
}>({
  description: '给 Slack 消息添加表情反应',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    channel: z.string().describe('频道 ID'),
    timestamp: z.string().describe('消息时间戳'),
    emoji: z.string().describe('表情名称（不含冒号）'),
  }),
  platforms: ['slack'],
  tags: ['slack'],
  async execute({ endpoint_id, channel, timestamp, emoji }) {
    const { getEndpoint } = getSlackAgentDeps();
    const endpoint = getEndpoint(endpoint_id);
    const success = await endpoint.addReaction(channel, timestamp, emoji);
    return { success, message: success ? `已添加反应 :${emoji}:` : '操作失败' };
  },
});
