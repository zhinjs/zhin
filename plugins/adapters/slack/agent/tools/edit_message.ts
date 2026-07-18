import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { getSlackAgentDeps } from '../../src/slack-agent-deps.js';

export default defineAgentTool<{
  endpoint_id: string;
  channel: string;
  message_ts: string;
  text: string;
}>({
  description: '编辑 Slack 消息',
  inputSchema: z.object({
    endpoint_id: z.string().describe('Endpoint 名称'),
    channel: z.string().describe('频道 ID'),
    message_ts: z.string().describe('消息时间戳'),
    text: z.string().describe('新的消息文本'),
  }),
  platforms: ['slack'],
  tags: ['slack'],
  async execute({ endpoint_id, channel, message_ts, text }) {
    const { getEndpoint } = getSlackAgentDeps();
    const endpoint = getEndpoint(endpoint_id);
    await endpoint.editMessage(channel, message_ts, [
      { type: 'text', data: { text } },
    ]);
    return { success: true, message: '消息已编辑' };
  },
});
