import { messages as t } from "../../../../messages.js";
import { currentChannel } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{
  timestamp: string;
}>({
  description: '置顶当前 Slack 会话中的消息',
  inputSchema: z.object({
    timestamp: z.string().describe('消息时间戳'),
  }),
  adapter: 'slack',
  tags: ['slack'],
  permissions: ['admin'],
  async execute({ timestamp }, context) {
    const channel = currentChannel(context, { allowDirect: true });
    const client = context.$client;
    await client.pins.add({ channel, timestamp });
    const success = true;
    return { success, message: success ? t(context.locale, 'messagePinned') : t(context.locale, 'operationFailed') };
  },
});
