import { messages as t } from "../../../../messages.js";
import { currentChannel } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { editSlackContent } from '@zhin.js/adapter-slack';

export default defineAgentTool<{
  message_ts: string;
  text: string;
}>({
  description: '编辑当前 Slack 频道（或私信）中你发出的消息',
  inputSchema: z.object({
    message_ts: z.string().describe('当前频道中的消息时间戳'),
    text: z.string().describe('新的消息文本'),
  }),
  adapter: 'slack',
  tags: ['slack'],
  async execute({ message_ts, text }, context) {
    const channel = currentChannel(context, { allowDirect: true });
    const client = context.$client;
    await editSlackContent(client, { channel, ts: message_ts, content: [
      { type: 'text', data: { text } },
    ] });
    return { success: true, message: t(context.locale, 'messageEdited') };
  },
});
