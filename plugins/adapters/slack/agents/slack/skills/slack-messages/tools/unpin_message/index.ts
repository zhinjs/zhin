import { messages as t } from "../../../../messages.js";
import { currentChannel } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{
  timestamp: string;
}>({
  description: '取消当前 Slack 会话中消息的置顶',
  inputSchema: z.object({
    timestamp: z.string().describe('消息时间戳'),
  }),
  adapter: 'slack',
  tags: ['slack'],
  permissions: ['admin'],
  async execute({ timestamp }, context) {
    const channel_id = currentChannel(context, { allowDirect: true });
    const client = context.$client;
    await client.pins.remove({ channel: channel_id, timestamp });
    const success = true;
    return { success, message: success ? t(context.locale, 'messageUnpinned') : t(context.locale, 'operationFailed') };
  },
});
