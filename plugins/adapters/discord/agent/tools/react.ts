import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';
import { requireDiscordGatewayClient } from '../../src/client.js';

export default defineAgentTool<{ channel_id: string; message_id: string; emoji: string }>({
  description: '对 Discord 消息添加表情反应',
  inputSchema: z.object({
    channel_id: z.string().describe('频道 ID'),
    message_id: z.string().describe('消息 ID'),
    emoji: z.string().describe('表情（Unicode 表情或自定义表情如 <:name:id>）'),
  }),
  adapter: 'discord',
  tags: ['discord'],
  async execute({ channel_id, message_id, emoji  }: { channel_id: string; message_id: string; emoji: string }, context) {
    const client = requireDiscordGatewayClient(context.$client);
    const channel = await client.channels.fetch(channel_id);
    if (!channel?.isTextBased() || !channel.messages) {
      throw new Error(`Channel ${channel_id} 不是文本频道`);
    }
    const message = await channel.messages.fetch(message_id);
    await message.react(emoji);
    return { success: true, message: `已添加反应 ${emoji}` };
  },
});
