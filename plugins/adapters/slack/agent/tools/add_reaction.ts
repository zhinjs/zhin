import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { normalizeSlackReactionName } from '../../src/slack-reaction.js';

export default defineAgentTool<{
  channel: string;
  timestamp: string;
  emoji: string;
}>({
  description: '给 Slack 消息添加表情反应',
  inputSchema: z.object({
    channel: z.string().describe('频道 ID'),
    timestamp: z.string().describe('消息时间戳'),
    emoji: z.string().describe('表情名称（不含冒号）'),
  }),
  adapter: 'slack',
  tags: ['slack'],
  async execute({ channel, timestamp, emoji }, context) {
    const client = context.$client;
    const name = normalizeSlackReactionName(emoji);
    try {
      await client.reactions.add({ channel, timestamp, name });
    } catch (error) {
      if ((error as { data?: { error?: string } })?.data?.error !== 'already_reacted') throw error;
    }
    const success = true;
    return { success, message: success ? `已添加反应 :${emoji}:` : '操作失败' };
  },
});
