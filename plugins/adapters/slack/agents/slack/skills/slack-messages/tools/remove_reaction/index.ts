import { messages as t } from "../../../../messages.js";
import { currentChannel } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { normalizeSlackReactionName } from '@zhin.js/adapter-slack';

export default defineAgentTool<{
  timestamp: string;
  name: string;
}>({
  description: '移除当前 Slack 频道（或私信）中消息上的表情反应',
  inputSchema: z.object({
    timestamp: z.string().describe('当前频道中的消息时间戳'),
    name: z.string().describe('表情名称（如 thumbsup、heart）'),
  }),
  adapter: 'slack',
  tags: ['slack'],
  async execute({ timestamp, name }, context) {
    const channel_id = currentChannel(context, { allowDirect: true });
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
    return { success, message: success ? t(context.locale, 'slackReactionRemoved', { p0: name }) : t(context.locale, 'operationFailed') };
  },
});
