import { messages as t } from "../../../../messages.js";
import { currentChannel } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{
  topic: string;
}>({
  description: '设置当前 Slack 频道话题',
  inputSchema: z.object({
    topic: z.string().describe('新话题'),
  }),
  adapter: 'slack',
  scopes: ["group"],
  tags: ['slack'],
  permissions: ['admin'],
  async execute({ topic }, context) {
    const channel = currentChannel(context);
    const client = context.$client;
    await client.conversations.setTopic({ channel, topic });
    const success = true;
    return { success, message: success ? t(context.locale, 'topicUpdated') : t(context.locale, 'operationFailed') };
  },
});
