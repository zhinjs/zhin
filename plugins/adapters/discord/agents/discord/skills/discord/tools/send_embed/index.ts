import { messages as t } from "../../../../messages.js";
import { currentChannel } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { requireDiscordGatewayClient } from '@zhin.js/adapter-discord';

export default defineAgentTool<{ title?: string; description?: string; color?: number; url?: string; fields?: string }>({
  description: '在当前 Discord 频道（或线程）发送富文本嵌入消息（Embed）',
  inputSchema: z.object({
    title: z.string().optional().describe('Embed 标题'),
    description: z.string().optional().describe('Embed 描述'),
    color: z.number().optional().describe('颜色值（十进制，如 0x00ff00 = 65280）'),
    url: z.string().optional().describe('标题链接（可选）'),
    fields: z.string().optional().describe('字段，JSON 格式: [{"name":"k","value":"v","inline":false}]'),
  }),
  adapter: 'discord',
  tags: ['discord'],
  async execute({ title, description, color, url, fields }, context) {
    const { channelId: channel_id } = currentChannel(context);
    const client = requireDiscordGatewayClient(context.$client);
    const embedData: Record<string, unknown> = {};
    if (title) embedData.title = title;
    if (description) embedData.description = description;
    if (color) embedData.color = color;
    if (url) embedData.url = url;
    if (fields) {
      try {
        embedData.fields = JSON.parse(fields);
      } catch {
        return { success: false, message: t(context.locale, 'invalidFields') };
      }
    }
    const channel = await client.channels.fetch(channel_id);
    if (!channel?.isSendable()) {
      throw new Error(t(context.locale, 'notTextChannel', { p0: channel_id }));
    }
    const msg = await channel.send({ embeds: [embedData] } as never);
    return { success: true, message_id: msg.id, message: t(context.locale, 'embedSent') };
  },
});
