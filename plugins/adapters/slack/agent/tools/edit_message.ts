import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { editSlackContent } from '../../src/slack-outbound.js';

export default defineAgentTool<{
  channel: string;
  message_ts: string;
  text: string;
}>({
  description: '编辑 Slack 消息',
  inputSchema: z.object({
    channel: z.string().describe('频道 ID'),
    message_ts: z.string().describe('消息时间戳'),
    text: z.string().describe('新的消息文本'),
  }),
  adapter: 'slack',
  tags: ['slack'],
  async execute({ channel, message_ts, text }, context) {
    const client = context.$client;
    await editSlackContent(client, channel, message_ts, [
      { type: 'text', data: { text } },
    ]);
    return { success: true, message: '消息已编辑' };
  },
});
