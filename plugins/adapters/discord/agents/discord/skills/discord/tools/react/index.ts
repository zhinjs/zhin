import { messages as t } from "../../../../messages.js";
import { currentChannel } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { requireDiscordGatewayClient } from '@zhin.js/adapter-discord';

export default defineAgentTool<{ message_id: string; emoji: string }>({
  description: '对当前 Discord 频道（或线程）中的消息添加表情反应',
  inputSchema: z.object({
    message_id: z.string().describe('当前频道中的消息 ID'),
    emoji: z.string().describe('表情（Unicode 表情或自定义表情如 <:name:id>）'),
  }),
  adapter: 'discord',
  tags: ['discord'],
  async execute({ message_id, emoji }, context) {
    const { channelId } = currentChannel(context);
    const client = requireDiscordGatewayClient(context.$client);
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !channel.messages) {
      throw new Error(t(context.locale, 'notTextChannel', { p0: channelId }));
    }
    const message = await channel.messages.fetch(message_id);
    await message.react(emoji);
    return { success: true, message: t(context.locale, 'reactionAdded', { p0: emoji }) };
  },
});
