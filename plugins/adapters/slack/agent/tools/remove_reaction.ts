import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { normalizeSlackReactionName } from '../../src/slack-reaction.js';

export default defineAgentTool<{
  channel_id: string;
  timestamp: string;
  name: string;
}>({
  description: '移除 Slack 消息上的表情反应',
  inputSchema: z.object({
    channel_id: z.string().describe('频道 ID'),
    timestamp: z.string().describe('消息时间戳'),
    name: z.string().describe('表情名称（如 thumbsup、heart）'),
  }),
  adapter: 'slack',
  tags: ['slack'],
  async execute({ channel_id, timestamp, name }, context) {
    const client = context.$client;
    try {
      await client.reactions.remove({
        channel: channel_id,
        timestamp,
        name: normalizeSlackReactionName(name),
      });
    } catch (error) {
      if ((error as { data?: { error?: string } })?.data?.error !== 'no_reaction') throw error;
    }
    const success = true;
    return { success, message: success ? `已移除反应 :${name}:` : '操作失败' };
  },
});
